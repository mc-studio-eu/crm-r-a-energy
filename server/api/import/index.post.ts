import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ASSIGNABLE_ROLES } from '../../../shared/types'
import {
  IMPORT_COLUMNS, IMPORT_COLUMN_KEYS, IMPORT_MAX_BYTES, IMPORT_MAX_COLUMNS, IMPORT_MAX_MB, IMPORT_MAX_ROWS,
  importCellText, isBlankImportRow, parseImportRows,
  type ImportCompany, type ImportPreview, type ImportProfile, type ImportResult, type ImportSheet,
} from '../../../shared/import-dossiers'
import { IMPORT_MAX_SHEETS, readImportWorkbook } from '../../utils/import-workbook'
import { requireRole, supabaseAdmin } from '../../utils/supabase-admin'

const MAX_BASE64_BYTES = Math.ceil(IMPORT_MAX_BYTES / 3) * 4
const MAX_BODY_BYTES = MAX_BASE64_BYTES + 600_000
const workbook = z.string().min(1).max(MAX_BASE64_BYTES)
const details = {
  workbook,
  sheet: z.number().int().min(0).max(IMPORT_MAX_SHEETS - 1),
  mapping: z.partialRecord(z.enum(IMPORT_COLUMN_KEYS), z.number().int().min(0).max(IMPORT_MAX_COLUMNS - 1)),
  statuses: z.record(z.string().max(255), z.enum(['en_cours', 'rdv_place', 'signe', 'perdu'])),
}
const line = z.number().int().min(2).max(IMPORT_MAX_ROWS + 1)
const request = z.discriminatedUnion('step', [
  z.object({ step: z.literal('sheets'), workbook }),
  z.object({ step: z.literal('preview'), ...details }),
  z.object({
    step: z.literal('confirm'),
    ...details,
    batch: z.uuid(),
    selection: z.array(z.object({ line, company: z.union([z.literal('new'), z.literal('new_duplicate'), z.uuid(), line]) })).min(1).max(IMPORT_MAX_ROWS),
  }),
])

function conflict(message: string) {
  return createError({ statusCode: 409, message })
}

export default defineEventHandler(async (event) => {
  const actor = await requireRole(event, ['admin'])
  setHeader(event, 'Cache-Control', 'private, no-store')

  const tooLarge = () => createError({ statusCode: 413, message: `Le fichier XLSX est trop volumineux (${IMPORT_MAX_MB} Mo maximum).` })
  if (Number(getHeader(event, 'content-length')) > MAX_BODY_BYTES) throw tooLarge()
  const stream = getRequestWebStream(event)
  if (!stream) throw createError({ statusCode: 400, message: 'Le fichier est manquant.' })
  const reader = stream.getReader()
  const chunks: Buffer[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) throw tooLarge()
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  let input: unknown
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw createError({ statusCode: 400, message: 'La demande d’import est illisible.' })
  }
  const parsed = request.safeParse(input)
  if (!parsed.success) throw createError({ statusCode: 400, message: 'Les paramètres d’import sont invalides.' })
  const body = parsed.data
  const admin = supabaseAdmin()
  let requestHash = ''
  if (body.step === 'confirm') {
    requestHash = createHash('sha256').update(body.workbook).update(JSON.stringify({
      sheet: body.sheet,
      mapping: Object.entries(body.mapping).sort(),
      statuses: Object.entries(body.statuses).sort(),
      selection: [...body.selection].sort((a, b) => a.line - b.line),
    })).digest('hex')
    const { data: receipt, error } = await admin.from('import_dossier_lots').select('empreinte, resultat')
      .eq('acteur_id', actor.id).eq('id', body.batch).maybeSingle()
    if (error) throw createError({ statusCode: 500, message: 'Impossible de vérifier le lot d’import.' })
    if (receipt) {
      if (receipt.empreinte !== requestHash) throw conflict('Ce lot correspond à une autre sélection.')
      return receipt.resultat as ImportResult
    }
  }

  const buffer = Buffer.from(body.workbook, 'base64')
  if (buffer.toString('base64') !== body.workbook) throw createError({ statusCode: 400, message: 'Le fichier transmis est invalide.' })
  const { sheets, epoch1904 } = await readImportWorkbook(buffer)
  if (body.step === 'sheets') {
    return sheets.map((sheet): ImportSheet => ({
      name: sheet.sheet,
      headers: (sheet.data[0] ?? []).map(cell => importCellText(cell).slice(0, 255)),
      rows: sheet.data.slice(1).filter(row => !isBlankImportRow(row)).length,
    }))
  }

  const sheet = sheets[body.sheet]
  const indices = Object.values(body.mapping)
  if (!sheet || indices.some(index => index >= (sheet.data[0]?.length ?? 0))
    || new Set(indices).size !== indices.length
    || IMPORT_COLUMN_KEYS.some(key => IMPORT_COLUMNS[key].required && body.mapping[key] === undefined)) {
    throw createError({ statusCode: 422, message: 'Associez chaque champ obligatoire à une colonne distincte.' })
  }
  const { data: profiles, error: profileError } = await admin.from('profiles').select('id, nom, role')
    .eq('actif', true).in('role', [...ASSIGNABLE_ROLES, 'telepro'])
  if (profileError) throw createError({ statusCode: 500, message: 'Impossible de vérifier les intervenants.' })
  const preview: ImportPreview = parseImportRows(sheet.data, body.mapping, body.statuses, profiles as ImportProfile[], epoch1904)
  if (body.step === 'preview') {
    const { data: candidates, error: candidateError } = await admin.rpc('import_dossier_societes', {
      p_acteur: actor.id,
      p_lignes: preview.rows.filter(row => row.dossier.raison_sociale && !row.dossier.raison_sociale.includes('\0'))
        .map(({ line, dossier }) => ({
          line,
          raison_sociale: dossier.raison_sociale,
          siret: dossier.siret && /^\d{14}$/.test(dossier.siret) ? dossier.siret : null,
        })),
    })
    if (candidateError) throw createError({ statusCode: 500, message: 'Impossible de vérifier les sociétés existantes.' })
    const existing = candidates as Record<string, ImportCompany[]>
    for (const row of preview.rows) row.companies = existing[row.line] ?? []
    return preview
  }

  const selected = new Map(body.selection.map(row => [row.line, row.company]))
  if (selected.size !== body.selection.length) throw conflict('Une ligne apparaît plusieurs fois dans la sélection.')
  const previewRows = new Map(preview.rows.map(row => [row.line, row]))
  const payload = Array.from(selected, ([line, company]) => {
    const row = previewRows.get(line)
    if (!row || row.errors.length) throw conflict(`Vérifiez la ligne ${line} avant l’import.`)
    // Les correspondances en base sont contrôlées dans la transaction, après la vérification du reçu.
    // Une confirmation concurrente du même lot peut ainsi retrouver le résultat déjà enregistré.
    if ((company === 'new' && row.duplicateInFile)
      || (typeof company === 'number' && (!row.earlierLines.includes(company) || !selected.has(company)))) {
      throw conflict(`Vérifiez le rattachement de la ligne ${line} dans un nouvel aperçu.`)
    }
    return { line, company, ...row.dossier }
  })
  const { data, error } = await admin.rpc('import_dossier_confirmer', {
    p_acteur: actor.id,
    p_id: body.batch,
    p_empreinte: requestHash,
    p_lignes: payload,
  })
  if (error?.code === '42501') throw createError({ statusCode: 403, message: 'L’import est réservé aux administrateurs actifs.' })
  if (error?.code === '40001') throw conflict(error.message)
  if (error) throw createError({ statusCode: 500, message: 'L’import a échoué. Vous pouvez réessayer la même sélection.' })
  return data as ImportResult
})
