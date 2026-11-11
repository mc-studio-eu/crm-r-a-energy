import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { asUser, createTestDatabase, seedUser } from './helpers/database'

describe('Migrations et accès PostgreSQL', () => {
  let db: PGlite
  let admin: string, commercial: string, external: string, inactive: string, dossier: string
  beforeAll(async () => {
    db = await createTestDatabase()
    admin = await seedUser(db, 'admin')
    commercial = await seedUser(db, 'commercial')
    external = await seedUser(db, 'apporteur_externe')
    inactive = await seedUser(db, 'commercial', { actif: false })
    dossier = randomUUID()
    await db.query("insert into prospects(id,raison_sociale,assigne_a,cree_par,statut) values($1,'Société test',$2,$3,'signe')", [dossier, commercial, admin])
  }, 60000)
  afterAll(async () => { await db?.close() })

  it('accepte une note sur 10 ou aucune note et refuse les valeurs hors barème', async () => {
    for (const note of [0, 7.5, 10, null]) {
      await asUser(db, admin, async () => {
        const result = await db.query<{ scoring_entreprise: string | null }>(
          'update prospects set scoring_entreprise=$2 where id=$1 returning scoring_entreprise', [dossier, note],
        )
        expect(result.rows[0]?.scoring_entreprise == null ? null : Number(result.rows[0]?.scoring_entreprise)).toBe(note)
      })
    }
    for (const note of [-1, 10.1]) {
      await expect(asUser(db, admin, () => db.query(
        'update prospects set scoring_entreprise=$2 where id=$1', [dossier, note],
      ))).rejects.toThrow(/prospects_scoring_entreprise_range/)
    }
  })

  it('refuse de modifier son rôle et son activation, autorise son nom', async () => {
    await expect(asUser(db, commercial, () => db.query("update profiles set role='admin' where id=$1", [commercial]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, commercial, () => db.query('update profiles set actif=false where id=$1', [commercial]))).rejects.toThrow(/permission denied/)
    await asUser(db, commercial, () => db.query("update profiles set nom='Nom autorisé' where id=$1", [commercial]))
  })

  it('ne crée pas un admin depuis les métadonnées modifiables par un utilisateur', async () => {
    const id = randomUUID()
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [id, 'metadata@example.test', JSON.stringify({ role: 'admin' })])
    expect((await db.query<{ role: string }>('select role from profiles where id=$1', [id])).rows[0]?.role).toBe('commercial')
  })

  it('isole les jetons et refuse les écritures directes RDV', async () => {
    await expect(asUser(db, commercial, () => db.query('select * from google_credentials'))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, commercial, () => db.query('select google_refresh_token from profiles'))).rejects.toThrow(/does not exist/)
    await expect(asUser(db, admin, () => db.query("insert into rdv(prospect_id,commercial_id,debut,fin) values($1,$2,now(),now()+interval '1 hour')", [dossier, commercial]))).rejects.toThrow(/permission denied/)
  })

  it('respecte les dossiers personnels et ferme les fiches opérationnelles aux apporteurs', async () => {
    const visible = await asUser(db, commercial, () => db.query('select id from prospects'))
    expect(visible.rows).toHaveLength(1)
    expect((await asUser(db, external, () => db.query('select id from prospects'))).rows).toHaveLength(0)
    expect((await asUser(db, inactive, () => db.query('select id from profiles'))).rows).toHaveLength(0)
  })

  it('ferme aussi l’annuaire, les anciens RDV et les commentaires aux apporteurs externes', async () => {
    expect((await asUser(db, external, () => db.query('select id from profiles'))).rows).toEqual([{ id: external }])
    await db.query("insert into rdv(prospect_id,commercial_id,debut,fin) values($1,$2,now(),now()+interval '1 hour')", [dossier, external])
    expect((await asUser(db, external, () => db.query('select id from rdv'))).rows).toHaveLength(0)
    await expect(asUser(db, external, () => db.query("insert into prospect_activites(prospect_id,auteur_id,type,detail) values($1,$2,'commentaire','Refusé')", [dossier, external]))).rejects.toThrow(/row-level security/)
  })

  it('ne rouvre pas un dossier signé à la prise de RDV', async () => {
    await db.query("insert into rdv(prospect_id,commercial_id,debut,fin,qualification) values($1,$2,now(),now()+interval '1 hour','R2')", [dossier, commercial])
    expect((await db.query<{ statut: string }>('select statut from prospects where id=$1', [dossier])).rows[0]?.statut).toBe('signe')
    const id = randomUUID()
    await db.query("insert into prospects(id,raison_sociale,statut) values($1,'En cours','en_cours')", [id])
    await db.query("insert into rdv(prospect_id,commercial_id,debut,fin) values($1,$2,now(),now()+interval '1 hour')", [id, commercial])
    expect((await db.query<{ statut: string }>('select statut from prospects where id=$1', [id])).rows[0]?.statut).toBe('rdv_place')
  })

  it('réserve toutes les données et RPC financières au serveur', async () => {
    for (const id of [admin, commercial, external]) {
      for (const table of ['finance_commissions', 'finance_repartitions', 'finance_echeances', 'finance_paiements', 'finance_audit']) {
        await expect(asUser(db, id, () => db.query(`select * from ${table}`))).rejects.toThrow(/permission denied/)
      }
      await expect(asUser(db, id, () => db.query('select finance_lire_dossier($1,$2)', [admin, dossier]))).rejects.toThrow(/permission denied/)
    }
  })
})
