import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createTestDatabase, seedUser } from './helpers/database'

type Dossier = { id: string, societe_id: string }
const dossierHistorique = '11111111-1111-4111-8111-111111111101'
const doublonHistorique = '11111111-1111-4111-8111-111111111102'
const dossierPartage = '11111111-1111-4111-8111-111111111103'
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
      if (file === '20261111000007_dossier_unique.sql') {
        const commercial = await seedUser(db, 'commercial')
        await db.exec("begin; select set_config('request.jwt.claim.role', 'service_role', true);")
        await db.query(`
          insert into prospects (id, societe_id, contact_nom, date_signature, created_at, updated_at)
          values ($1, $2, 'Contact du second dossier', '2026-07-02', $3, $3)
        `, [dossierPartage, dossierHistorique, '2026-07-02T00:00:00.000Z'])
        await db.query('insert into finance_commissions (prospect_id, commission_cents) values ($1, 12345)', [dossierPartage])
        await db.query(`
          insert into prospect_documents (prospect_id, nom, storage_path)
          values ($1, 'Facture partagée', $1::uuid::text || '/facture.pdf')
        `, [dossierPartage])
        await db.query(`
          insert into rdv (prospect_id, commercial_id, debut, fin)
          values ($1, $2, '2026-07-02T09:00Z', '2026-07-02T10:00Z')
        `, [dossierPartage, commercial])
        // La création du RDV modifie le dossier. Garde une date connue pour vérifier la migration.
        await db.exec('alter table prospects disable trigger prospects_updated_at')
        await db.query("update prospects set updated_at = '2026-07-02T00:00:00Z' where id = $1", [dossierPartage])
        await db.exec('alter table prospects enable trigger prospects_updated_at; commit;')
      }
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
      'select id, statut, societe_id, updated_at from prospects where id in ($1, $2) order by id',
      [dossierHistorique, doublonHistorique],
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

  it('sépare les dossiers auparavant rattachés à la même société et conserve les liens du dossier déplacé', async () => {
    const { rows } = await db.query<{
      id: string, societe_id: string, raison_sociale: string, siret: string,
      contact_nom: string, updated_at: Date, commission: string, document: string, rendez_vous: string,
    }>(`
      select p.id, p.societe_id, s.raison_sociale, s.siret, p.contact_nom, p.updated_at,
        c.commission_cents::text as commission, d.nom as document, r.prospect_id as rendez_vous
      from prospects p
      join societes s on s.id = p.societe_id
      join finance_commissions c on c.prospect_id = p.id
      join prospect_documents d on d.prospect_id = p.id
      join rdv r on r.prospect_id = p.id
      where p.id = $1
    `, [dossierPartage])
    expect(rows).toEqual([expect.objectContaining({
      id: dossierPartage, raison_sociale: 'Société historique', siret: '98765432100011',
      contact_nom: 'Contact du second dossier', commission: '12345', document: 'Facture partagée',
      rendez_vous: dossierPartage, updated_at: new Date('2026-07-02T00:00:00Z'),
    })])
    expect(rows[0]?.societe_id).not.toBe(dossierHistorique)
    expect((await db.query('select societe_id from prospects where id = $1', [dossierHistorique])).rows)
      .toEqual([{ societe_id: dossierHistorique }])
  })

  it('conserve deux sociétés distinctes pour deux créations au même SIRET', async () => {
    expect(premier.societe_id).not.toBe(second.societe_id)
    const { rows } = await db.query('select id from societes where siret = $1', ['12345678900011'])
    expect(rows).toHaveLength(2)
  })

  it('préserve les droits de lecture et de création des dossiers', async () => {
    const visibles = await asUser(db, telepro, () => db.query('select id from societes'))
    expect(visibles.rows).toEqual([{ id: premier.societe_id }])
    expect((await asUser(db, apporteur, () => db.query('select id from societes'))).rows).toEqual([])

    const { rows } = await asUser(db, telepro, () => db.query(`
      insert into prospects (raison_sociale, siret, cree_par, source, energie, debut_livraison, fin_livraison)
      values ('  Société test  ', '  12345678900011 ', $1, 'Recommandation', 'electricite', '2027-01-01', '2027-12-31')
      returning raison_sociale, siret, statut, source, energie
    `, [telepro]))
    expect(rows).toEqual([{
      raison_sociale: 'Société test',
      siret: '12345678900011',
      statut: 'en_cours',
      source: 'Recommandation',
      energie: 'electricite',
    }])

    await expect(asUser(db, apporteur, () => db.query("insert into prospects (raison_sociale) values ('Création interdite')")))
      .rejects.toMatchObject({ code: '42501' })
    expect((await db.query("select id from societes where raison_sociale = 'Création interdite'")).rows).toEqual([])
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

  it('modifie l’identité depuis le dossier visible et protège celle des autres dossiers', async () => {
    await asUser(db, telepro, async () => {
      const { rows } = await db.query(`
        update prospects set raison_sociale = ' Nom modifié ', siret = ' '
        where id = $1 returning raison_sociale, siret, societe_id
      `, [premier.id])
      expect(rows).toEqual([{ raison_sociale: 'Nom modifié', siret: null, societe_id: premier.societe_id }])
      expect((await db.query('select raison_sociale, siret from societes where id = $1', [premier.societe_id])).rows)
        .toEqual([{ raison_sociale: 'Nom modifié', siret: null }])
      expect((await db.query("update prospects set raison_sociale = 'Interdit' where id = $1 returning id", [second.id])).rows)
        .toEqual([])
    })
    await expect(asUser(db, telepro, () => db.query(
      "update prospects set raison_sociale = 'Interdit', cree_par = $2 where id = $1", [premier.id, admin],
    ))).rejects.toMatchObject({ code: '42501' })
    expect((await db.query('select distinct raison_sociale from societes where id in ($1, $2)', [premier.societe_id, second.societe_id])).rows)
      .toEqual([{ raison_sociale: 'Société test' }])
  })

  it('interdit le rattachement et ferme les anciennes actions séparées, même pour un admin', async () => {
    await expect(asUser(db, admin, () => db.query(
      "insert into prospects (societe_id, raison_sociale) values ($1, 'Nouveau dossier')", [premier.societe_id],
    ))).rejects.toMatchObject({ code: '22023' })
    await expect(asUser(db, admin, () => db.query(
      'update prospects set societe_id = $2 where id = $1', [premier.id, second.societe_id],
    ))).rejects.toMatchObject({ code: '22023' })
    await expect(asUser(db, admin, () => db.query('select merge_societes($1, $2)', [premier.societe_id, second.societe_id])))
      .rejects.toMatchObject({ code: '42501' })
    await expect(asUser(db, admin, () => db.query("select update_societe($1, 'Nom interdit', null)", [premier.societe_id])))
      .rejects.toMatchObject({ code: '42501' })
  })

  it('maintient la société interne lors des créations ignorées et des suppressions', async () => {
    await db.query("insert into prospects (id, raison_sociale) values ($1, 'Création ignorée') on conflict (id) do nothing", [second.id])
    expect((await db.query("select id from societes where raison_sociale = 'Création ignorée'")).rows).toEqual([])

    const { rows } = await db.query<Dossier>("insert into prospects (raison_sociale) values ('Dossier à supprimer') returning id, societe_id")
    const { id, societe_id } = rows[0]!
    await db.query('delete from prospects where id = $1', [id])
    expect((await db.query('select id from societes where id = $1', [societe_id])).rows).toEqual([])
  })
})
