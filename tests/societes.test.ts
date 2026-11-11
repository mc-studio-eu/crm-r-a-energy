import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createTestDatabase, seedUser } from './helpers/database'

type Dossier = { id: string, societe_id: string }
const dossierHistorique = '11111111-1111-4111-8111-111111111101'
const doublonHistorique = '11111111-1111-4111-8111-111111111102'
const dateHistorique = '2026-07-01T00:00:00.000Z'

describe('Sociétés et dossiers', () => {
  let db: PGlite
  let admin: string
  let telepro: string
  let apporteur: string
  let premier: Dossier
  let second: Dossier

  beforeAll(async () => {
    db = await createTestDatabase(async (db, file) => {
      if (file !== '20261111000001_enums.sql') return
      const commercial = await seedUser(db, 'commercial')
      await db.query(`
        insert into prospects (id, raison_sociale, siret, statut, created_at, updated_at)
        values ($1, 'Société historique', '98765432100011', 'a_rappeler', $3, $3),
               ($2, 'Société historique', '98765432100011', 'nouveau', $3, $3)
      `, [dossierHistorique, doublonHistorique, dateHistorique])
      await db.query(`
        insert into prospect_activites (prospect_id, type, ancien_statut, nouveau_statut)
        values ($1, 'statut', 'nouveau', 'a_rappeler')
      `, [dossierHistorique])
      await db.query(`
        insert into prospect_documents (prospect_id, nom, storage_path)
        values ($1, 'Facture historique', $1::uuid::text || '/facture.pdf')
      `, [dossierHistorique])
      await db.query(`
        insert into rdv (prospect_id, commercial_id, debut, fin)
        values ($1, $2, '2026-07-02T09:00Z', '2026-07-02T10:00Z')
      `, [dossierHistorique, commercial])
    })
    admin = await seedUser(db, 'admin')
    telepro = await seedUser(db, 'telepro')
    apporteur = await seedUser(db, 'apporteur_externe')

    const { rows } = await db.query<Dossier>(`
      insert into prospects(raison_sociale, siret, cree_par, contact_nom, energie)
      values ('Société test', '12345678900011', $1, 'Contact A', 'gaz'),
             ('Société test', '12345678900011', $2, 'Contact B', 'electricite')
      returning id, societe_id
    `, [telepro, admin])
    premier = rows[0]!
    second = rows[1]!
  }, 60000)

  afterAll(async () => { await db?.close() })

  it('migre chaque ancien prospect avec ses liens, ses dates et son historique de statut', async () => {
    const { rows } = await db.query<{ id: string, statut: string, societe_id: string, updated_at: Date }>(
      "select id, statut, societe_id, updated_at from prospects where siret = '98765432100011' order by id",
    )
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.id)).toEqual([dossierHistorique, doublonHistorique])
    expect(new Set(rows.map(row => row.societe_id)).size).toBe(2)
    expect(rows.map(row => row.statut)).toEqual(['en_cours', 'en_cours'])
    expect(rows.map(row => row.updated_at.toISOString())).toEqual([dateHistorique, dateHistorique])

    const historique = await db.query(
      "select ancien_statut, nouveau_statut from prospect_activites where prospect_id = $1 and type = 'statut' order by created_at",
      [dossierHistorique],
    )
    expect(historique.rows).toEqual([
      { ancien_statut: 'nouveau', nouveau_statut: 'a_rappeler' },
      { ancien_statut: 'a_rappeler', nouveau_statut: 'en_cours' },
    ])
    expect((await db.query('select id from rdv where prospect_id = $1', [dossierHistorique])).rows).toHaveLength(1)
    expect((await db.query('select id from prospect_documents where prospect_id = $1', [dossierHistorique])).rows).toHaveLength(1)
  })

  it('conserve deux sociétés distinctes pour deux créations au même SIRET', async () => {
    expect(premier.societe_id).not.toBe(second.societe_id)
    const { rows } = await db.query('select id from societes where siret = $1', ['12345678900011'])
    expect(rows).toHaveLength(2)
  })

  it('limite la consultation et le rattachement aux sociétés visibles', async () => {
    const visibles = await asUser(db, telepro, () => db.query('select id from societes'))
    expect(visibles.rows).toEqual([{ id: premier.societe_id }])
    expect((await asUser(db, apporteur, () => db.query('select id from societes'))).rows).toEqual([])

    const { rows } = await asUser(db, telepro, () => db.query(`
      insert into prospects (societe_id, cree_par, source, energie, debut_livraison, fin_livraison)
      values ($1, $2, 'Recommandation', 'electricite', '2027-01-01', '2027-12-31')
      returning raison_sociale, siret, statut, source, energie
    `, [premier.societe_id, telepro]))
    expect(rows).toEqual([{
      raison_sociale: 'Société test',
      siret: '12345678900011',
      statut: 'en_cours',
      source: 'Recommandation',
      energie: 'electricite',
    }])

    await expect(asUser(db, telepro, () => db.query(
      'insert into prospects (societe_id, cree_par) values ($1, $2)',
      [second.societe_id, telepro],
    ))).rejects.toThrow(/Société inaccessible/)
  })

  it('refuse les dates inversées et un ancien statut pour les nouveaux dossiers', async () => {
    await expect(db.exec(`
      insert into prospects (raison_sociale, debut_livraison, fin_livraison)
      values ('Création invalide', '2027-03-01', '2027-01-01')
    `)).rejects.toThrow(/prospects_livraison_dates/)
    await expect(db.exec(`
      insert into prospects (raison_sociale, statut) values ('Création invalide', 'a_rappeler')
    `)).rejects.toThrow(/prospects_statut_actif/)
    expect((await db.query("select id from societes where raison_sociale = 'Création invalide'")).rows).toEqual([])
  })

  it('réserve la fusion à l’admin et conserve les dossiers et leurs activités', async () => {
    const ids = [premier.societe_id, second.societe_id]
    await expect(asUser(db, telepro, () => db.query('select merge_societes($1, $2)', ids)))
      .rejects.toThrow(/Fusion réservée/)

    await asUser(db, admin, async () => {
      await db.query("insert into prospect_activites(prospect_id, auteur_id, type, detail) values($1, $2, 'commentaire', 'À conserver')", [premier.id, admin])
      await db.query('select update_societe($1, $2, $3)', [second.societe_id, 'Nouvelle raison sociale', null])
      await db.query('select merge_societes($1, $2)', ids)

      const { rows } = await db.query(`
        select id, societe_id, raison_sociale, contact_nom, energie
        from prospects where societe_id = $1 order by contact_nom
      `, [second.societe_id])
      expect(rows).toEqual([
        { id: premier.id, societe_id: second.societe_id, raison_sociale: 'Nouvelle raison sociale', contact_nom: 'Contact A', energie: 'gaz' },
        { id: second.id, societe_id: second.societe_id, raison_sociale: 'Nouvelle raison sociale', contact_nom: 'Contact B', energie: 'electricite' },
      ])
      expect((await db.query('select id from societes where id = $1', [premier.societe_id])).rows).toEqual([])

      const activites = await db.query<{ detail: string }>('select detail from prospect_activites where prospect_id = $1', [premier.id])
      expect(activites.rows.map(a => a.detail)).toEqual(expect.arrayContaining([
        'À conserver',
        'Société fusionnée : Société test → Nouvelle raison sociale',
      ]))
    })
  })
})
