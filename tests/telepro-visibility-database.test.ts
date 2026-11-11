import { afterAll, beforeAll, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createTestDatabase, seedUser } from './helpers/database'

let db: PGlite
let admin: string, telepro: string, autreTelepro: string, dossier: string, personnel: string

beforeAll(async () => {
  db = await createTestDatabase()
  admin = await seedUser(db, 'admin')
  telepro = await seedUser(db, 'telepro')
  autreTelepro = await seedUser(db, 'telepro')
  const creer = async (createur: string) => (await db.query<{ id: string }>(
    "insert into prospects(raison_sociale,cree_par) values ('Test visibilité',$1) returning id", [createur],
  )).rows[0]!.id
  dossier = await creer(admin)
  personnel = await creer(telepro)
  await db.query('update prospects set teleprospecteur_id=$2 where id=$1', [dossier, telepro])
}, 60000)

afterAll(async () => { await db?.close() })

it('liste les dossiers créés ou affectés, sans exposer les dossiers des autres téléprospecteurs', async () => {
  const result = await asUser(db, telepro, () => db.query<{ id: string }>('select id from prospects'))
  expect(result.rows.map(row => row.id).sort()).toEqual([dossier, personnel].sort())
  expect((await asUser(db, autreTelepro, () => db.query('select id from prospects'))).rows).toEqual([])
})

it('permet de consulter et modifier la fiche affectée', async () => {
  await asUser(db, telepro, async () => {
    expect((await db.query('select id from prospects where id=$1', [dossier])).rows).toHaveLength(1)
    expect((await db.query("update prospects set notes='Suivi télépro' where id=$1 returning notes", [dossier])).rows)
      .toEqual([{ notes: 'Suivi télépro' }])
  })
})

it('retire l’accès après réaffectation et le donne au nouveau téléprospecteur', async () => {
  await db.exec('BEGIN')
  try {
    await db.query('update prospects set teleprospecteur_id=$2 where id=$1', [dossier, autreTelepro])
    await db.exec('SET LOCAL ROLE authenticated')
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [telepro])
    expect((await db.query('select id from prospects where id=$1', [dossier])).rows).toEqual([])
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [autreTelepro])
    expect((await db.query('select id from prospects where id=$1', [dossier])).rows).toHaveLength(1)
  }
  finally { await db.exec('ROLLBACK') }
})

it('refuse l’accès au téléprospecteur désactivé même affecté au dossier', async () => {
  await db.query('update profiles set actif=false where id=$1', [telepro])
  try {
    expect((await asUser(db, telepro, () => db.query('select id from prospects'))).rows).toEqual([])
  }
  finally { await db.query('update profiles set actif=true where id=$1', [telepro]) }
})
