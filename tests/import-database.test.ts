import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createTestDatabase, seedUser } from './helpers/database'
import type { ImportResult } from '../shared/import-dossiers'

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
  line: 2, company: 'new', raison_sociale: name, statut: 'en_cours', ...data,
})
const fingerprint = 'a'.repeat(64)

async function confirm(rows: object[], batch = randomUUID(), hash = fingerprint, actor = admin) {
  return (await db.query<{ result: ImportResult }>(
    'select public.import_dossier_confirmer($1,$2,$3,$4::jsonb) as result', [actor, batch, hash, JSON.stringify(rows)],
  )).rows[0]!.result
}

describe('confirmation transactionnelle d’un import Excel', () => {
  it('crée des dossiers en distinguant une commission vide et une commission à zéro', async () => {
    const result = await asService(() => confirm([
      row('Éoliennes du Nord', { commission_cents: 0, siret: '12345678901234' }),
      row('Centrale du Sud', { line: 4, statut: 'signe', date_signature: '2026-11-11' }),
    ]))
    expect(result.count).toBe(2)
    const imported = await db.query(
      `select p.raison_sociale, p.societe_id is not null as rattachee, c.commission_cents::text as commission
       from public.prospects p left join public.finance_commissions c on c.prospect_id=p.id
       where p.id = any($1::uuid[]) order by commission nulls last`, [result.dossiers.map(entry => entry.id)],
    )
    expect(imported.rows).toEqual([
      { raison_sociale: 'Éoliennes du Nord', rattachee: true, commission: '0' },
      { raison_sociale: 'Centrale du Sud', rattachee: true, commission: null },
    ])
  })

  it('signale les doublons et rattache un nouveau dossier après un choix explicite', async () => {
    const original = await asService(() => confirm([row('Société existante', { siret: '11111111111111' })]))
    const company = (await db.query<{ societe_id: string }>('select societe_id from public.prospects where id=$1', [original.dossiers[0]!.id])).rows[0]!.societe_id
    const candidateRows = [row('societe existante', { siret: '22222222222222' })]
    const { rows } = await asService(() => db.query<{ result: Record<string, { id: string }[]> }>(
      'select public.import_dossier_societes($1,$2::jsonb) as result', [admin, JSON.stringify(candidateRows)],
    ))
    expect(rows[0]?.result['2']?.map(candidate => candidate.id)).toEqual([company])
    await expect(asService(() => confirm(candidateRows))).rejects.toMatchObject({ code: '40001' })
    const linked = await asService(() => confirm([
      row('societe existante', { company, statut: 'signe' }),
      row('societe existante', { company: 2, line: 3, statut: 'perdu' }),
    ]))
    const linkedRows = await db.query<{ societe_id: string, statut: string }>(
      'select societe_id,statut from public.prospects where id=any($1::uuid[]) order by statut', [linked.dossiers.map(entry => entry.id)],
    )
    expect(linkedRows.rows).toEqual([{ societe_id: company, statut: 'signe' }, { societe_id: company, statut: 'perdu' }])
    expect((await db.query('select raison_sociale,siret,statut from public.prospects where id=$1', [original.dossiers[0]!.id])).rows[0]).toEqual({
      raison_sociale: 'Société existante', siret: '11111111111111', statut: 'en_cours',
    })
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
