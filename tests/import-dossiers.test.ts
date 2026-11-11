import { describe, expect, it } from 'vitest'
import writeXlsxFile from 'write-excel-file/node'
import { makeImportTemplate, readImportWorkbook } from '../server/utils/import-workbook'
import {
  IMPORT_COLUMNS, inferImportMapping, parseImportCommission, parseImportDate, parseImportRows,
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

  it('conserve les numéros Excel et applique Signé à un statut inconnu sans bloquer', async () => {
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
    expect(first.rows[1]?.errors).toEqual([])
    expect(first.rows[1]?.dossier.statut).toBe('signe')
    const second = parseImportRows(sheets[0]!.data, columns, { accepte: 'perdu' }, [])
    expect(second.rows[1]?.dossier).toMatchObject({ statut: 'perdu', commission_cents: 0, date_signature: '2026-11-11' })
    expect(second.rows[1]?.errors).toEqual([])
  })

  it('importe les statuts vides, absents et Parcours finalisé comme Signé', () => {
    expect(IMPORT_COLUMNS.statut.required).toBe(false)
    for (const status of [null, '', 'Parcours finalisé']) {
      const preview = parseImportRows([
        ['Société', 'Commission HT', 'Statut'],
        ['Épicerie', 384.98, status],
      ], columns, {}, [])
      expect(preview.rows[0]?.dossier.statut).toBe('signe')
      expect(preview.rows[0]?.errors).toEqual([])
    }
    const preview = parseImportRows([
      ['Société', 'Commission HT'], ['Boulangerie', 100],
    ], { raison_sociale: 0, commission_ht: 1 }, {}, [])
    expect(preview.rows[0]?.dossier.statut).toBe('signe')
    expect(preview.rows[0]?.errors).toEqual([])
  })

  it('distingue deux énergies pour le même SIRET et normalise les suffixes saisis', () => {
    const preview = parseImportRows([
      ['Société', 'Commission HT', 'SIRET', 'Énergie'],
      ['Épicerie', 100, '12345678901234', 'Élec'],
      ['Épicerie ( GAZ )', 100, '12345678901234', 'Gaz'],
    ], { raison_sociale: 0, commission_ht: 1, siret: 2, energie: 3 }, {}, [])

    expect(preview.rows).toMatchObject([
      { dossier: { raison_sociale: 'Épicerie (Élec)', energie: 'electricite' }, duplicateInFile: false, errors: [] },
      { dossier: { raison_sociale: 'Épicerie (Gaz)', energie: 'gaz' }, duplicateInFile: false, errors: [] },
    ])
  })

  it('signale encore les doublons de même énergie ou sans énergie et les noms trop longs après suffixe', () => {
    const preview = parseImportRows([
      ['Société', 'Commission HT', 'SIRET', 'Énergie'],
      ['Épicerie (Électricité)', 100, '12345678901234', 'Électricité'],
      ['Autre nom', 100, '12345678901234', 'Élec'],
      ['epicerie', 100, null, null],
      ['A'.repeat(255), 100, null, 'Gaz'],
    ], { raison_sociale: 0, commission_ht: 1, siret: 2, energie: 3 }, {}, [])

    expect(preview.rows.map(row => row.duplicateInFile)).toEqual([true, true, true, false])
    expect(preview.rows[0]?.dossier.raison_sociale).toBe('Épicerie (Élec)')
    expect(preview.rows[2]?.dossier.raison_sociale).toBe('epicerie')
    expect(preview.rows[3]?.errors).toContain('La société dépasse 255 caractères avec le suffixe de l’énergie.')
  })

  it('résout les fournisseurs du catalogue par code ou nom et signale les fournisseurs inconnus ou inactifs', () => {
    const fournisseurs = [
      { code: 'fournisseur-uuid-1', nom: 'Énergie Nouvelle', actif: true },
      { code: 'fournisseur-uuid-2', nom: 'Fournisseur arrêté', actif: false },
    ]
    const rows = [
      ['Société', 'Commission HT', 'Statut', 'Fournisseur'],
      ['Par code', 100, 'Signé', 'fournisseur-uuid-1'],
      ['Par nom', 100, 'Signé', 'energie nouvelle'],
      ['Inactif', 100, 'Signé', 'Fournisseur arrêté'],
      ['Inconnu', 100, 'Signé', 'Autre fournisseur'],
    ]
    const preview = parseImportRows(rows, {
      raison_sociale: 0, commission_ht: 1, statut: 2, fournisseur: 3,
    }, {}, [], false, fournisseurs)

    expect(preview.rows[0]?.dossier.fournisseur).toBe('fournisseur-uuid-1')
    expect(preview.rows[1]?.dossier.fournisseur).toBe('fournisseur-uuid-1')
    expect(preview.rows[2]?.dossier.fournisseur).toBeNull()
    expect(preview.rows[2]?.errors).toContain('Fournisseur désactivé.')
    expect(preview.rows[3]?.dossier.fournisseur).toBeNull()
    expect(preview.rows[3]?.errors).toContain('Fournisseur inconnu.')
  })

  it('priorise le nom du fournisseur sur un ancien code qui porte le même texte', () => {
    const preview = parseImportRows([
      ['Société', 'Commission HT', 'Statut', 'Fournisseur'],
      ['Par nom', 100, 'Signé', 'Mint'],
    ], { raison_sociale: 0, commission_ht: 1, statut: 2, fournisseur: 3 }, {}, [], false, [
      { code: 'mint', nom: 'Autre', actif: true },
      { code: 'fournisseur-xyz', nom: 'Mint', actif: true },
    ])

    expect(preview.rows[0]?.dossier.fournisseur).toBe('fournisseur-xyz')
  })

  it('rejette un fichier incompatible ou une feuille hors limites', async () => {
    await expect(readImportWorkbook(Buffer.from('A;B;C'))).rejects.toMatchObject({ statusCode: 422 })
    const buffer = await writeXlsxFile([Array.from({ length: 65 }, (_, index) => `Colonne ${index}`)]).toBuffer()
    await expect(readImportWorkbook(buffer)).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('64 colonnes') })
  })
})
