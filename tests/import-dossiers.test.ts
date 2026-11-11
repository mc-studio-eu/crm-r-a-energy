import { describe, expect, it } from 'vitest'
import writeXlsxFile from 'write-excel-file/node'
import { makeImportTemplate, readImportWorkbook } from '../server/utils/import-workbook'
import {
  inferImportMapping, parseImportCommission, parseImportDate, parseImportRows,
  type ImportMapping,
} from '../shared/import-dossiers'

const columns: ImportMapping = { raison_sociale: 0, commission_ht: 1, statut: 2, siret: 3, date_signature: 4 }

describe('import de dossiers Excel', () => {
  it('propose les correspondances du modèle téléchargé', async () => {
    const { sheets } = await readImportWorkbook(await makeImportTemplate())
    expect(sheets.map(sheet => sheet.sheet)).toEqual(['Dossiers', 'Guide'])
    expect(inferImportMapping(sheets[0]!.data[0]!.map(String))).toMatchObject({ raison_sociale: 0, commission_ht: 1, statut: 2, fin_livraison: 8 })
    expect(sheets[0]?.data).toHaveLength(1)
    expect(inferImportMapping(['Société', 'Entreprise', 'Commission HT'])).toEqual({ commission_ht: 2 })
  })

  it('sépare les commissions inconnues, nulles et mal formées', () => {
    expect(parseImportCommission(null)).toBeNull()
    expect(parseImportCommission('  ')).toBeNull()
    expect(parseImportCommission('0,00 €')).toBe(0)
    expect(parseImportCommission('1\u202f234,56 €')).toBe(123456)
    expect(parseImportCommission(1.18)).toBe(118)
    expect(() => parseImportCommission('1 23,45')).toThrow()
    expect(() => parseImportCommission('1,234')).toThrow()
    expect(() => parseImportCommission('-5')).toThrow()
  })

  it('lit les dates françaises, Excel et ISO et rejette les dates impossibles', () => {
    expect(parseImportDate('29/02/2024')).toBe('2024-02-29')
    expect(parseImportDate('2026-11-11')).toBe('2026-11-11')
    expect(parseImportDate(1)).toBe('1900-01-01')
    expect(parseImportDate(0, true)).toBe('1904-01-01')
    expect(parseImportDate(61)).toBe('1900-03-01')
    expect(() => parseImportDate(60)).toThrow()
    expect(() => parseImportDate('31/04/2026')).toThrow()
  })

  it('conserve les numéros Excel et attend un choix pour un statut inconnu', async () => {
    const buffer = await writeXlsxFile([
      ['Société', 'Commission HT', 'Statut', 'SIRET', 'Date de signature'],
      ['Énergie SARL', null, 'Nouveau', '01234567890123'],
      [null, null, null, null, null],
      ['energie sarl', '0,00 €', 'Accepté', null, { value: new Date('2026-11-11'), format: 'dd/mm/yyyy' }],
    ]).toBuffer()
    const { sheets } = await readImportWorkbook(buffer)
    const first = parseImportRows(sheets[0]!.data, columns, {}, [])
    expect(first.unknownStatuses).toEqual([{ key: 'accepte', label: 'Accepté' }])
    expect(first.rows.map(row => row.line)).toEqual([2, 4])
    expect(first.rows[0]?.dossier).toMatchObject({ statut: 'en_cours', commission_cents: null, siret: '01234567890123' })
    expect(first.rows[0]?.duplicateInFile).toBe(true)
    expect(first.rows[1]?.duplicateInFile).toBe(true)
    expect(first.rows[1]?.errors).toHaveLength(1)
    const second = parseImportRows(sheets[0]!.data, columns, { accepte: 'signe' }, [])
    expect(second.rows[1]?.dossier).toMatchObject({ statut: 'signe', commission_cents: 0, date_signature: '2026-11-11' })
    expect(second.rows[1]?.errors).toEqual([])
  })

  it('rejette un fichier incompatible ou une feuille hors limites', async () => {
    await expect(readImportWorkbook(Buffer.from('A;B;C'))).rejects.toMatchObject({ statusCode: 422 })
    const buffer = await writeXlsxFile([Array.from({ length: 65 }, (_, index) => `Colonne ${index}`)]).toBuffer()
    await expect(readImportWorkbook(buffer)).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('64 colonnes') })
  })
})
