import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createTestDatabase, seedUser } from './helpers/database'
import { parseImportRows, type ImportResult } from '../shared/import-dossiers'

let db: Awaited<ReturnType<typeof createTestDatabase>>
let admin: string
let commercial: string

beforeAll(async () => {
  db = await createTestDatabase()
  admin = await seedUser(db, 'admin')
  commercial = await seedUser(db, 'commercial')
}, 30_000)
afterAll(async () => { await db?.close() })

async function asService<T>(callback: () => Promise<T>) {
  await db.exec("BEGIN; SET LOCAL ROLE service_role; select set_config('request.jwt.claim.role','service_role',true);")
  try {
    const result = await callback()
    await db.exec('COMMIT')
    return result
  } catch (error) {
    await db.exec('ROLLBACK')
    throw error
  }
}

const row = (name: string, data: Record<string, unknown> = {}) => ({
  line: 2, allow_duplicate: false, raison_sociale: name, statut: 'en_cours', ...data,
})
const fingerprint = 'a'.repeat(64)

async function confirm(rows: object[], batch = randomUUID(), hash = fingerprint, actor = admin) {
  return (await db.query<{ result: ImportResult }>(
    'select public.import_dossier_confirmer($1,$2,$3,$4::jsonb) as result', [actor, batch, hash, JSON.stringify(rows)],
  )).rows[0]!.result
}

async function candidates(lines: object[]) {
  const { rows } = await asService(() => db.query<{ result: Record<string, { id: string }[]> }>(
    'select public.import_dossier_societes($1,$2::jsonb) as result', [admin, JSON.stringify(lines)],
  ))
  return rows[0]!.result
}

describe('confirmation transactionnelle d’un import Excel', () => {
  it('crée des dossiers en distinguant une commission vide et une commission à zéro', async () => {
    const result = await asService(() => confirm([
      row('Éoliennes du Nord', { commission_cents: 0, siret: '12345678901234' }),
      row('Centrale du Sud', { line: 4, statut: 'signe', date_signature: '2026-11-11' }),
    ]))
    expect(result.count).toBe(2)
    const imported = await db.query(
      `select s.raison_sociale, c.commission_cents::text as commission
       from public.prospects p join public.societes s on s.id = p.societe_id
       left join public.finance_commissions c on c.prospect_id=p.id
       where p.id = any($1::uuid[]) order by commission nulls last`, [result.dossiers.map(entry => entry.id)],
    )
    expect(imported.rows).toEqual([
      { raison_sociale: 'Éoliennes du Nord', commission: '0' },
      { raison_sociale: 'Centrale du Sud', commission: null },
    ])
  })

  it('signale les doublons et crée un dossier distinct pour chaque ligne confirmée', async () => {
    const original = await asService(() => confirm([row('Société existante', { siret: '11111111111111' })]))
    const company = (await db.query<{ societe_id: string }>('select societe_id from public.prospects where id=$1', [original.dossiers[0]!.id])).rows[0]!.societe_id
    const candidateRows = [row('societe existante', { siret: '22222222222222' })]
    const { rows } = await asService(() => db.query<{ result: Record<string, { id: string }[]> }>(
      'select public.import_dossier_societes($1,$2::jsonb) as result', [admin, JSON.stringify(candidateRows)],
    ))
    expect(rows[0]?.result['2']?.map(candidate => candidate.id)).toEqual([company])
    await expect(asService(() => confirm(candidateRows))).rejects.toMatchObject({ code: '40001' })
    const imported = await asService(() => confirm([
      row('societe existante', { allow_duplicate: true, siret: '22222222222222', statut: 'signe' }),
      row('societe existante', { allow_duplicate: true, siret: '33333333333333', line: 3, statut: 'perdu' }),
    ]))
    const importedRows = await db.query<{ societe_id: string, statut: string, siret: string }>(
      'select societe_id, statut, siret from public.prospects where id=any($1::uuid[]) order by statut', [imported.dossiers.map(entry => entry.id)],
    )
    expect(new Set([company, ...importedRows.rows.map(row => row.societe_id)]).size).toBe(3)
    expect(importedRows.rows).toMatchObject([
      { statut: 'signe', siret: '22222222222222' },
      { statut: 'perdu', siret: '33333333333333' },
    ])
    expect((await db.query('select raison_sociale,siret,statut from public.prospects where id=$1', [original.dossiers[0]!.id])).rows[0]).toEqual({
      raison_sociale: 'Société existante', siret: '11111111111111', statut: 'en_cours',
    })
  })

  it('crée un dossier par énergie pour une même entreprise et bloque sa réimportation à énergie identique', async () => {
    const { rows } = parseImportRows([
      ['Société', 'Commission HT', 'SIRET', 'Énergie'],
      ['Atelier Énergie', 100, '78901234567890', 'Électricité'],
      ['Atelier Énergie', 200, '78901234567890', 'Gaz'],
    ], { raison_sociale: 0, commission_ht: 1, siret: 2, energie: 3 }, {}, [])
    const payload = rows.map(({ line, dossier }) => ({ line, allow_duplicate: false, ...dossier }))
    const result = await asService(() => confirm(payload))
    expect(result.count).toBe(2)
    const saved = await db.query<{ raison_sociale: string, energie: string, siret: string, societe_id: string }>(
      'select raison_sociale, energie, siret, societe_id from public.prospects where id=any($1::uuid[]) order by energie',
      [result.dossiers.map(entry => entry.id)],
    )
    expect(saved.rows).toMatchObject([
      { raison_sociale: 'Atelier Énergie (Élec)', energie: 'electricite', siret: '78901234567890' },
      { raison_sociale: 'Atelier Énergie (Gaz)', energie: 'gaz', siret: '78901234567890' },
    ])
    expect(saved.rows[0]?.societe_id).not.toBe(saved.rows[1]?.societe_id)
    expect(await candidates(payload)).toMatchObject({
      2: [{ id: saved.rows[0]?.societe_id }],
      3: [{ id: saved.rows[1]?.societe_id }],
    })
    await expect(asService(() => confirm([row('Nom modifié (Gaz)', { siret: '78901234567890', energie: 'gaz' })])))
      .rejects.toMatchObject({ code: '40001' })
  })

  it('écarte seulement une énergie différente dans le CRM, même pour les anciens noms sans suffixe', async () => {
    await db.query(`insert into public.prospects (raison_sociale, energie, cree_par)
      values ('Commerce historique', 'electricite', $1), ('Société sans énergie', null, $1)`, [admin])

    const gas = row('Commerce historique (Gaz)', { energie: 'gaz' })
    const elec = row('Commerce historique (Élec)', { line: 3, energie: 'electricite' })
    const unknown = row('Société sans énergie (Gaz)', { line: 4, energie: 'gaz' })
    const matches = await candidates([gas, elec, unknown])
    expect(matches['2']).toHaveLength(0)
    expect(matches['3']).toHaveLength(1)
    expect(matches['4']).toHaveLength(1)
    await expect(asService(() => confirm([elec]))).rejects.toMatchObject({ code: '40001' })
    await expect(asService(() => confirm([unknown]))).rejects.toMatchObject({ code: '40001' })
    await expect(asService(() => confirm([gas]))).resolves.toMatchObject({ count: 1 })
  })

  it('refuse les anciennes demandes de rattachement à une société ou à une ligne du fichier', async () => {
    await expect(asService(() => confirm([row('Rattachement historique', { company: randomUUID() })])))
      .rejects.toMatchObject({ code: '22023' })
    await expect(asService(() => confirm([
      row('Rattachement historique'),
      row('Rattachement historique', { company: 2, line: 3, allow_duplicate: true }),
    ]))).rejects.toMatchObject({ code: '22023' })
    expect((await db.query("select id from public.prospects where raison_sociale = 'Rattachement historique'")).rows).toEqual([])
  })

  it('annule les lignes précédentes si une ligne du lot échoue', async () => {
    await expect(asService(() => confirm([
      row('Transaction annulée', { commission_cents: 100 }),
      row('Ligne invalide', { line: 3, commission_cents: -1 }),
    ]))).rejects.toMatchObject({ code: '22023' })
    const { rows } = await db.query("select id from public.societes where raison_sociale in ('Transaction annulée','Ligne invalide')")
    expect(rows).toEqual([])
  })

  it('rejoue la confirmation sans recréer de dossier et refuse un lot réutilisé avec une autre empreinte', async () => {
    const batch = randomUUID()
    const payload = [row('Lot idempotent')]
    const result = await asService(() => confirm(payload, batch))
    expect(await asService(() => confirm(payload, batch))).toEqual(result)
    await expect(asService(() => confirm(payload, batch, 'b'.repeat(64)))).rejects.toMatchObject({ code: '40001' })
    const { rows } = await db.query("select id from public.prospects where raison_sociale='Lot idempotent'")
    expect(rows).toEqual([{ id: result.dossiers[0]!.id }])
  })

  it('interdit l’exécution directe par un client et vérifie le rôle de l’acteur', async () => {
    await expect(asUser(db, admin, () => confirm([row('Accès direct')]))).rejects.toMatchObject({ code: '42501' })
    await expect(asService(() => confirm([row('Rôle interdit')], randomUUID(), fingerprint, commercial))).rejects.toMatchObject({ code: '42501' })
  })
})
