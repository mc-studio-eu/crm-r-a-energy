import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createTestDatabase, seedUser } from './helpers/database'

describe('Référentiel PostgreSQL des fournisseurs', () => {
  let db: PGlite
  let admin: string, commercial: string, inactive: string

  beforeAll(async () => {
    db = await createTestDatabase()
    admin = await seedUser(db, 'admin')
    commercial = await seedUser(db, 'commercial')
    inactive = await seedUser(db, 'commercial', { actif: false })
  }, 60000)
  afterAll(async () => { await db?.close() })

  async function dossier(fournisseur: string | null = null) {
    return (await db.query<{ id: string }>(
      'insert into prospects(raison_sociale,fournisseur) values($1,$2) returning id',
      ['Dossier référentiel', fournisseur],
    )).rows[0]!.id
  }

  it('installe les quatre fournisseurs initiaux et conserve une référence lors du renommage', async () => {
    const initial = await db.query<{ code: string }>(
      "select code from public.fournisseurs where code in ('gazelle_energy','mint','ohm','jeety') order by code",
    )
    expect(initial.rows.map(row => row.code)).toEqual(['gazelle_energy', 'jeety', 'mint', 'ohm'])

    const id = await dossier('mint')
    const result = await asUser(db, admin, async () => {
      await db.query("update public.fournisseurs set nom='Mint Énergie' where code='mint'")
      return db.query<{ fournisseur: string, nom: string }>(
        'select p.fournisseur, f.nom from prospects p join fournisseurs f on f.code=p.fournisseur where p.id=$1', [id],
      )
    })
    expect(result.rows[0]).toEqual({ fournisseur: 'mint', nom: 'Mint Énergie' })
  })

  it('permet à un admin de créer un fournisseur personnalisé et de l’affecter', async () => {
    const assigned = await asUser(db, admin, async () => {
      const inserted = await db.query<{ code: string }>(
        "insert into public.fournisseurs(nom) values('Fournisseur test') returning code",
      )
      const code = inserted.rows[0]!.code
      const prospect = await db.query<{ fournisseur: string }>(
        'insert into prospects(raison_sociale,fournisseur) values($1,$2) returning fournisseur',
        ['Dossier custom', code],
      )
      return prospect.rows[0]?.fournisseur
    })
    expect(assigned).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('expose le catalogue aux comptes actifs seulement', async () => {
    const actif = await asUser(db, commercial, () => db.query<{ code: string }>('select code from public.fournisseurs'))
    expect(actif.rows.length).toBeGreaterThanOrEqual(4)
    expect((await asUser(db, inactive, () => db.query('select code from public.fournisseurs'))).rows).toEqual([])

    await db.exec('BEGIN; SET LOCAL ROLE anon;')
    try {
      await db.query("select set_config('request.jwt.claim.role','anon',true)")
      await expect(db.query('select code from public.fournisseurs')).rejects.toThrow()
    } finally {
      await db.exec('ROLLBACK;')
    }
  })

  it('réserve création et renommage aux admins, rend le code immuable et interdit la suppression', async () => {
    await expect(asUser(db, commercial, () => db.query(
      "insert into public.fournisseurs(code,nom) values('non_admin','Non admin')",
    ))).rejects.toThrow()
    const deniedUpdate = await asUser(db, commercial, () => db.query<{ code: string }>(
      "update public.fournisseurs set nom='Changement refusé' where code='mint' returning code",
    ))
    expect(deniedUpdate.rows).toEqual([])
    expect((await db.query<{ nom: string }>("select nom from public.fournisseurs where code='mint'")).rows[0]?.nom)
      .not.toBe('Changement refusé')
    await expect(asUser(db, admin, () => db.query(
      "update public.fournisseurs set code='mint_renomme' where code='mint'",
    ))).rejects.toThrow()
    await expect(asUser(db, admin, () => db.query("delete from public.fournisseurs where code='mint'")))
      .rejects.toThrow()
  })

  it('bloque les nouvelles affectations inactives sans invalider les dossiers existants', async () => {
    const id = await dossier('ohm')
    await db.query("update public.fournisseurs set actif=false where code='ohm'")

    await expect(dossier('ohm')).rejects.toThrow()
    await db.query("update prospects set raison_sociale='Dossier conservé' where id=$1", [id])
    expect((await db.query<{ fournisseur: string, raison_sociale: string }>(
      'select fournisseur,raison_sociale from prospects where id=$1', [id],
    )).rows[0]).toMatchObject({ fournisseur: 'ohm', raison_sociale: 'Dossier conservé' })
  })

  it('refuse une référence fournisseur inexistante', async () => {
    await expect(dossier('code_inconnu')).rejects.toThrow()
  })
})
