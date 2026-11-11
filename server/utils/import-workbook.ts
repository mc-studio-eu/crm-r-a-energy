import { createError } from 'h3'
import readXlsxFile from 'read-excel-file/universal'
import { Parser } from 'saxen'
import { fromBufferPromise } from 'yauzl'
import writeXlsxFile from 'write-excel-file/node'
import { FOURNISSEURS, PROSPECT_STATUTS } from '../../shared/types'
import {
  IMPORT_COLUMNS, IMPORT_COLUMN_KEYS, IMPORT_MAX_BYTES, IMPORT_MAX_COLUMNS, IMPORT_MAX_MB, IMPORT_MAX_ROWS, type ImportCell,
} from '../../shared/import-dossiers'

export const IMPORT_MAX_SHEETS = 20
const MAX_ARCHIVE_ENTRIES = 256
const MAX_EXPANDED_BYTES = 24 * 1024 * 1024
const MAX_CELLS = 150_000

class ImportWorkbookLimit extends Error {}

function columnNumber(letters: string) {
  let column = 0
  for (const letter of letters) column = column * 26 + letter.charCodeAt(0) - 64
  return column
}

async function inspectWorkbookArchive(buffer: Buffer) {
  const zip = await fromBufferPromise(buffer, { lazyEntries: true, autoClose: false })
  let expandedBytes = 0
  let sheetCount = 0
  let cells = 0
  let epoch1904 = false
  const files = new Set<string>()
  try {
    if (zip.entryCount > MAX_ARCHIVE_ENTRIES) throw new ImportWorkbookLimit('Le classeur contient trop de fichiers internes.')
    for await (const entry of zip.eachEntry()) {
      expandedBytes += entry.uncompressedSize
      if (expandedBytes > MAX_EXPANDED_BYTES) throw new ImportWorkbookLimit('Le contenu décompressé du classeur est trop volumineux.')
      if (files.has(entry.fileName)) throw new Error('Duplicate ZIP entry')
      files.add(entry.fileName)
      if (entry.fileName.endsWith('/')) continue

      // Yauzl contrôle la taille réelle des données lues, avant de confier le classeur au lecteur XLSX.
      const stream = await zip.openReadStreamPromise(entry)
      const isXml = /\.(?:xml|rels)$/i.test(entry.fileName)
      const chunks: Buffer[] = []
      for await (const chunk of stream) {
        if (isXml) chunks.push(Buffer.from(chunk))
      }
      if (!isXml) continue

      const parser = new Parser()
      let sheet = false
      let rows = 0
      let columns = 0
      parser.on('error', (error) => { throw error })
      parser.on('warn', (error) => { throw error })
      parser.on('attention', () => { throw new Error('Unsupported XML declaration') })
      parser.on('openTag', (tag, getAttrs) => {
        const name = tag.slice(tag.lastIndexOf(':') + 1)
        if (name === 'sheetData') sheet = true
        if (entry.fileName === 'xl/workbook.xml') {
          if (name === 'sheet' && ++sheetCount > IMPORT_MAX_SHEETS) throw new ImportWorkbookLimit(`Le classeur est limité à ${IMPORT_MAX_SHEETS} feuilles.`)
          if (name === 'workbookPr') epoch1904 = ['1', 'true'].includes(getAttrs().date1904 ?? '')
        }
        if (!sheet) return
        if (name === 'row') {
          const row = getAttrs().r
          columns = 0
          if (++rows > IMPORT_MAX_ROWS + 1 || (row && Number(row) > IMPORT_MAX_ROWS + 1)) {
            throw new ImportWorkbookLimit(`Chaque feuille est limitée à ${IMPORT_MAX_ROWS} lignes de données.`)
          }
        }
        if (name === 'c') {
          const ref = getAttrs().r
          const position = ref && /^([A-Z]+)([1-9]\d*)$/.exec(ref)
          if (ref && !position) throw new Error('Invalid cell address')
          if (position && Number(position[2]) > IMPORT_MAX_ROWS + 1) {
            throw new ImportWorkbookLimit(`Chaque feuille est limitée à ${IMPORT_MAX_ROWS} lignes de données.`)
          }
          if (++columns > IMPORT_MAX_COLUMNS || (position && columnNumber(position[1]!) > IMPORT_MAX_COLUMNS)) {
            throw new ImportWorkbookLimit(`Chaque feuille est limitée à ${IMPORT_MAX_COLUMNS} colonnes.`)
          }
          if (++cells > MAX_CELLS) throw new ImportWorkbookLimit('Le classeur contient trop de cellules.')
        }
      })
      parser.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
    }
  } finally {
    zip.close()
  }
  if (!files.has('[Content_Types].xml') || !files.has('xl/workbook.xml') || sheetCount === 0) {
    throw new Error('Missing workbook sheets')
  }
  if (files.has('xl/vbaProject.bin')) throw new Error('Macro-enabled workbook')
  return { epoch1904, sheetCount }
}

export async function readImportWorkbook(buffer: Buffer) {
  if (buffer.byteLength === 0 || buffer.byteLength > IMPORT_MAX_BYTES) {
    throw createError({ statusCode: 413, message: `Le fichier doit peser entre 1 octet et ${IMPORT_MAX_MB} Mo.` })
  }
  try {
    const { epoch1904, sheetCount } = await inspectWorkbookArchive(buffer)
    // Le type publié utilise typeof Date, mais la bibliothèque renvoie des instances de Date.
    const sheets = await readXlsxFile(Uint8Array.from(buffer).buffer) as unknown as { sheet: string, data: ImportCell[][] }[]
    if (sheets.length !== sheetCount || sheets.some(sheet => !Array.isArray(sheet.data))) {
      throw new Error('Invalid workbook sheets')
    }
    if (sheets.some(sheet => sheet.data.length > IMPORT_MAX_ROWS + 1
      || sheet.data.some(row => row.length > IMPORT_MAX_COLUMNS))) {
      throw new ImportWorkbookLimit('Une feuille dépasse les limites de lignes ou de colonnes.')
    }
    return { sheets, epoch1904 }
  } catch (error) {
    const message = error instanceof ImportWorkbookLimit ? error.message : 'Le fichier XLSX est illisible ou incompatible.'
    throw createError({ statusCode: 422, message })
  }
}

export function makeImportTemplate() {
  const heading = { fontWeight: 'bold' as const, color: '#FFFFFF', backgroundColor: '#31694E' }
  return writeXlsxFile([
    {
      sheet: 'Dossiers',
      data: [IMPORT_COLUMN_KEYS.map(key => ({ ...heading, value: IMPORT_COLUMNS[key].label }))],
      columns: IMPORT_COLUMN_KEYS.map(key => ({ width: Math.max(14, IMPORT_COLUMNS[key].label.length + 5) })),
    },
    {
      sheet: 'Guide',
      data: [
        [{ ...heading, value: 'Colonne' }, { ...heading, value: 'Valeurs attendues' }],
        ['Société', 'Obligatoire. Indiquez la raison sociale.'],
        ['Commission HT', 'En euros. Laissez vide si inconnue. Saisissez 0 si le montant est nul.'],
        ['Statut', Object.values(PROSPECT_STATUTS).join(', ')],
        ['SIRET', 'Facultatif. Saisissez les 14 chiffres au format texte.'],
        ['Fournisseur', Object.values(FOURNISSEURS).join(', ')],
        ['Énergie', 'Gaz ou Électricité.'],
        ['Dates', 'Date Excel ou JJ/MM/AAAA.'],
        ['Intervenants', 'Nom du compte actif ou identifiant du compte en cas d’homonymie.'],
      ],
      columns: [{ width: 24 }, { width: 88 }],
    },
  ]).toBuffer()
}
