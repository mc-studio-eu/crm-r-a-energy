import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { asUser, createTestDatabase, seedUser } from './helpers/database'

describe('Accès PostgreSQL du rôle administratif', () => {
  let db: PGlite
  let administratif: string
  let autreAdministratifInactif: string
  let admin: string
  let dossierUn: string
  let dossierDeux: string
  let beneficiaireHistorique: string

  beforeAll(async () => {
    db = await createTestDatabase()
    admin = await seedUser(db, 'admin')
    administratif = await seedUser(db, 'administratif')
    autreAdministratifInactif = await seedUser(db, 'administratif', { actif: false })
    const commercial = await seedUser(db, 'commercial')
    dossierUn = randomUUID()
    dossierDeux = randomUUID()
    await db.query(
      `insert into public.prospects(id, raison_sociale, contact_nom, assigne_a, cree_par)
       values ($1, 'Dossier A', 'Contact A', $2, $3), ($4, 'Dossier B', 'Contact B', $5, $6)`,
      [dossierUn, commercial, admin, dossierDeux, admin, commercial],
    )
    await db.query('update public.prospects set archive = true where id = $1', [dossierUn])
    await db.query(
      `insert into public.rdv(prospect_id, commercial_id, debut, fin)
       values ($1, $2, now(), now() + interval '1 hour')`, [dossierUn, administratif],
    )
    beneficiaireHistorique = (await db.query<{ id: string }>(
      `insert into public.finance_beneficiaires(nom, profil_id) values ('Bénéficiaire historique', $1) returning id`,
      [administratif],
    )).rows[0]!.id
  }, 60000)

  afterAll(async () => { await db?.close() })

  it('voit et peut modifier tous les dossiers, quel que soit leur créateur ou leur affectation', async () => {
    const visible = await asUser(db, administratif, () => db.query<{ id: string }>(
      'select id from public.prospects order by id',
    ))
    expect(visible.rows.map(row => row.id).sort()).toEqual([dossierUn, dossierDeux].sort())

    const changed = await asUser(db, administratif, () => db.query<{ raison_sociale: string, notes: string }>(
      `update public.prospects set raison_sociale = 'Fiche mise à jour', notes = 'Complété par administratif'
       where id = $1 returning raison_sociale, notes`, [dossierDeux],
    ))
    expect(changed.rows).toEqual([{ raison_sociale: 'Fiche mise à jour', notes: 'Complété par administratif' }])
  })

  it('voit les dossiers archivés, mais ne peut créer, archiver ni restaurer un dossier', async () => {
    const archived = await asUser(db, administratif, () => db.query<{ id: string, archive: boolean }>(
      'select id, archive from public.prospects where id = $1', [dossierUn],
    ))
    expect(archived.rows).toEqual([{ id: dossierUn, archive: true }])

    await expect(asUser(db, administratif, () => db.query(
      "insert into public.prospects(raison_sociale, cree_par) values ('Nouveau dossier', $1)", [administratif],
    ))).rejects.toThrow(/non autorisée|row-level security/i)
    await expect(asUser(db, administratif, () => db.query(
      'update public.prospects set archive = true where id = $1', [dossierDeux],
    ))).rejects.toThrow(/modification réservée/i)
    await expect(asUser(db, administratif, () => db.query(
      'update public.prospects set archive = false where id = $1', [dossierUn],
    ))).rejects.toThrow(/modification réservée/i)
  })

  it('peut ajouter les métadonnées d’un document et téléverser le fichier d’un dossier quelconque', async () => {
    const storagePath = `${dossierUn}/${randomUUID()}.pdf`
    await asUser(db, administratif, async () => {
      await db.query(
        `insert into public.prospect_documents(prospect_id, nom, storage_path, mime_type, taille, uploade_par)
         values ($1, 'Contrat', $2, 'application/pdf', 1234, $3)`,
        [dossierUn, storagePath, administratif],
      )
      await db.query(
        `insert into storage.objects(bucket_id, name, owner_id)
         values ('prospect-documents', $1, $2)`, [storagePath, administratif],
      )
      expect((await db.query<{ nom: string }>(
        'select nom from public.prospect_documents where prospect_id = $1', [dossierUn],
      )).rows).toEqual([{ nom: 'Contrat' }])
    })
  })

  it('ne donne pas accès aux rendez-vous historiques associés au compte', async () => {
    expect((await asUser(db, administratif, () => db.query(
      'select id from public.rdv where commercial_id = $1', [administratif],
    ))).rows).toEqual([])
    await expect(asUser(db, administratif, () => db.query(
      "update public.rdv set statut = 'annule' where commercial_id = $1", [administratif],
    ))).rejects.toMatchObject({ code: '42501' })
  })

  it('refuse toute lecture et modification financière, y compris par accès direct aux tables', async () => {
    for (const table of [
      'finance_beneficiaires', 'finance_commissions', 'finance_repartitions',
      'finance_echeances', 'finance_paiements', 'finance_audit',
    ]) {
      await expect(asUser(db, administratif, () => db.query(`select * from public.${table}`)))
        .rejects.toThrow(/permission denied/i)
      await expect(asUser(db, administratif, () => db.query(`delete from public.${table}`)))
        .rejects.toThrow(/permission denied/i)
    }

    await expect(asUser(db, administratif, () => db.query(
      'select public.finance_lire_dossier($1, $2)', [administratif, dossierUn],
    ))).rejects.toThrow(/permission denied|administrateurs/i)
    await expect(asUser(db, administratif, () => db.query(
      `select public.finance_modifier_dossier($1, $2, 'commission', $3::jsonb)`,
      [administratif, dossierUn, JSON.stringify({ commission_cents: 100, repartitions: [] })],
    ))).rejects.toThrow(/permission denied|administrateurs/i)
    await expect(asUser(db, administratif, () => db.query(
      'select public.finance_tableau($1, 2026, 11, null, null, null, null, null, 1)', [administratif],
    ))).rejects.toThrow(/permission denied|administrateurs/i)

    await db.exec('BEGIN; SET LOCAL ROLE service_role;')
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role','service_role',true)", [administratif])
      await expect(db.query(
        'select public.finance_tableau($1, 2026, 11, null, null, null, $2, null, 1)',
        [administratif, beneficiaireHistorique],
      )).rejects.toThrow(/compte désactivé/i)
    }
    finally { await db.exec('ROLLBACK') }
  })

  it('ne peut ni attribuer les rôles, ni activer les comptes, ni créer ou supprimer des profils', async () => {
    await expect(asUser(db, administratif, () => db.query(
      "update public.profiles set role = 'admin' where id = $1", [administratif],
    ))).rejects.toThrow(/permission denied/i)
    await expect(asUser(db, administratif, () => db.query(
      'update public.profiles set actif = false where id = $1', [administratif],
    ))).rejects.toThrow(/permission denied/i)
    await expect(asUser(db, administratif, () => db.query(
      "insert into public.profiles(id, role, nom) values ($1, 'administratif', 'Nouveau')", [randomUUID()],
    ))).rejects.toThrow(/permission denied|row-level security/i)
    const deleted = await asUser(db, administratif, () => db.query(
      'delete from public.profiles where id = $1 returning id', [admin],
    ))
    expect(deleted.rows).toEqual([])
  })

  it('retire l’accès aux données CRM et aux documents quand le compte est désactivé', async () => {
    expect((await asUser(db, autreAdministratifInactif, () => db.query('select id from public.prospects'))).rows)
      .toEqual([])
    expect((await asUser(db, autreAdministratifInactif, () => db.query('select id from public.profiles'))).rows)
      .toEqual([])
    expect((await asUser(db, autreAdministratifInactif, () => db.query('select id from public.prospect_documents'))).rows)
      .toEqual([])
    expect((await asUser(db, autreAdministratifInactif, () => db.query(
      "select id from storage.objects where bucket_id = 'prospect-documents'",
    ))).rows).toEqual([])
    await expect(asUser(db, autreAdministratifInactif, () => db.query(
      'select public.finance_lire_dossier($1, $2)', [autreAdministratifInactif, dossierUn],
    ))).rejects.toThrow(/permission denied|administrateurs/i)
  })
})
