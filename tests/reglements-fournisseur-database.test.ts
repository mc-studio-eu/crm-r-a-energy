import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createTestDatabase, seedUser } from './helpers/database'

describe('Échéancier fournisseur PostgreSQL', () => {
  let db: PGlite
  let admin: string, commercial: string, telepro: string, regieInterne: string, regieExterne: string, apporteur: string
  let adminInactif: string, commercialInactif: string
  let prospectId: string

  beforeAll(async () => {
    db = await createTestDatabase()
    admin = await seedUser(db, 'admin')
    commercial = await seedUser(db, 'commercial')
    telepro = await seedUser(db, 'telepro')
    regieInterne = await seedUser(db, 'regie_interne')
    regieExterne = await seedUser(db, 'regie_externe')
    apporteur = await seedUser(db, 'apporteur_externe')
    adminInactif = await seedUser(db, 'admin', { actif: false })
    commercialInactif = await seedUser(db, 'commercial', { actif: false })
    prospectId = (await db.query<{ id: string }>(
      "insert into public.prospects(raison_sociale) values('Dossier échéancier fournisseur') returning id",
    )).rows[0]!.id
  }, 60000)
  afterAll(async () => { await db?.close() })

  async function creer(libelle: string, extras: Record<string, unknown> = {}) {
    return (await db.query<{ id: string }>(
      `insert into public.prospect_reglements_fournisseur
        (prospect_id, libelle, date_prevue, annee_prevue, montant_cents, taux_bps, date_reception, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [prospectId, libelle, extras.date_prevue ?? null, extras.annee_prevue ?? null,
        extras.montant_cents ?? null, extras.taux_bps ?? null, extras.date_reception ?? null, extras.note ?? null],
    )).rows[0]!.id
  }

  function rpc(prospectId: string, action: string, payload: Record<string, unknown>) {
    return db.query('select modifier_reglement_fournisseur($1,$2,$3,$4)', [admin, prospectId, action, payload])
  }

  it('autorise une ligne avec le seul libellé et accepte chaque mode de prévision séparément', async () => {
    const labelOnly = await creer('À réception')
    const byDate = await creer('Versement daté', { date_prevue: '2027-03-15' })
    const byYear = await creer('Versement annuel', { annee_prevue: 2028 })
    const rows = await db.query<{
      id: string, date_prevue: string | null, annee_prevue: number | null,
      montant_cents: number | null, taux_bps: number | null,
    }>(
      'select id,date_prevue::text as date_prevue,annee_prevue,montant_cents,taux_bps from public.prospect_reglements_fournisseur where id in ($1,$2,$3)',
      [labelOnly, byDate, byYear],
    )
    expect(rows.rows).toHaveLength(3)
    expect(rows.rows.find(row => row.id === labelOnly)).toMatchObject({
      date_prevue: null, annee_prevue: null, montant_cents: null, taux_bps: null,
    })
    expect(rows.rows.find(row => row.id === byDate)?.date_prevue).toContain('2027-03-15')
    expect(rows.rows.find(row => row.id === byYear)?.annee_prevue).toBe(2028)
  })

  it('accepte un montant et un taux optionnels indépendants, et dérive la réception de sa date', async () => {
    const amountOnly = await creer('Montant connu', { montant_cents: 125000 })
    const rateOnly = await creer('Taux connu', { taux_bps: 2750 })
    const received = await creer('Déjà reçu', { date_reception: '2026-11-10' })
    const rows = await db.query<{
      id: string, montant_cents: number | null, taux_bps: number | null,
      date_reception: string | null, statut?: string,
    }>(
      'select id,montant_cents,taux_bps,date_reception::text as date_reception from public.prospect_reglements_fournisseur where id in ($1,$2,$3)',
      [amountOnly, rateOnly, received],
    )
    expect(rows.rows.find(row => row.id === amountOnly)).toMatchObject({ montant_cents: 125000, taux_bps: null })
    expect(rows.rows.find(row => row.id === rateOnly)).toMatchObject({ montant_cents: null, taux_bps: 2750 })
    const reçu = rows.rows.find(row => row.id === received)!
    expect(reçu.date_reception).toContain('2026-11-10')
    // Le statut n'est pas une donnée indépendante en base : la date suffit à le déterminer.
    expect(reçu).not.toHaveProperty('statut')
  })

  it('réserve lecture, création, modification et suppression aux comptes admin actifs', async () => {
    const id = await creer('Échéance confidentielle')

    for (const actor of [commercial, telepro, regieInterne, regieExterne, apporteur]) {
      const visible = await asUser(db, actor, () => db.query(
        'select id from public.prospect_reglements_fournisseur where id=$1', [id],
      ))
      expect(visible.rows, `ligne visible avec le rôle de ${actor}`).toEqual([])

      await expect(asUser(db, actor, () => db.query(
        "update public.prospect_reglements_fournisseur set libelle='Modification non autorisée' where id=$1", [id],
      ))).rejects.toThrow()
      await expect(asUser(db, actor, () => db.query(
        'delete from public.prospect_reglements_fournisseur where id=$1', [id],
      ))).rejects.toThrow()
      await expect(asUser(db, actor, () => creer('Création non autorisée'))).rejects.toThrow()
    }

    for (const actor of [adminInactif, commercialInactif]) {
      const visible = await asUser(db, actor, () => db.query(
        'select id from public.prospect_reglements_fournisseur where id=$1', [id],
      ))
      expect(visible.rows).toEqual([])
      await expect(asUser(db, actor, () => creer('Compte inactif'))).rejects.toThrow()
    }

    const visibleAdmin = await asUser(db, admin, () => db.query(
      'select id from public.prospect_reglements_fournisseur where id=$1', [id],
    ))
    expect(visibleAdmin.rows).toHaveLength(1)
    await expect(asUser(db, admin, () => db.query(
      "update public.prospect_reglements_fournisseur set libelle='Écriture directe refusée' where id=$1", [id],
    ))).rejects.toThrow()
    await rpc(prospectId, 'enregistrer', {
      id, libelle: 'Échéance corrigée', date_prevue: null, annee_prevue: null,
      montant_cents: null, taux_bps: null, note: null,
    })
    expect((await db.query<{ libelle: string }>(
      'select libelle from public.prospect_reglements_fournisseur where id=$1', [id],
    )).rows[0]?.libelle).toBe('Échéance corrigée')
    await rpc(prospectId, 'supprimer', { id })
    expect((await db.query('select id from public.prospect_reglements_fournisseur where id=$1', [id])).rows).toEqual([])
  })

  it('refuse les dates incohérentes, les champs hors limites et les libellés invalides', async () => {
    await expect(creer('Deux prévisions', { date_prevue: '2027-01-01', annee_prevue: 2027 })).rejects.toThrow()
    for (const annee_prevue of [0, 10000]) {
      await expect(creer('Année invalide', { annee_prevue })).rejects.toThrow()
    }
    for (const montant_cents of [0, -1, 1000000000001]) {
      await expect(creer('Montant invalide', { montant_cents })).rejects.toThrow()
    }
    for (const taux_bps of [0, -1, 10001]) {
      await expect(creer('Taux invalide', { taux_bps })).rejects.toThrow()
    }
    for (const date_prevue of ['not-a-date', '10000-01-01']) {
      await expect(creer('Date invalide', { date_prevue })).rejects.toThrow()
    }
    for (const date_reception of ['not-a-date', '10000-01-01']) {
      await expect(creer('Réception invalide', { date_reception })).rejects.toThrow()
    }
    for (const libelle of ['', '   ', `x${'x'.repeat(150)}`]) {
      await expect(creer(libelle)).rejects.toThrow()
    }
    await expect(creer('Note trop longue', { note: 'x'.repeat(501) })).rejects.toThrow()
  })

  it('verrouille l’appartenance au dossier après création', async () => {
    const anotherProspect = (await db.query<{ id: string }>(
      "insert into public.prospects(raison_sociale) values('Autre dossier') returning id",
    )).rows[0]!.id
    const id = await creer('Échéance liée')
    await expect(asUser(db, admin, () => db.query(
      'update public.prospect_reglements_fournisseur set prospect_id=$2 where id=$1', [id, anotherProspect],
    ))).rejects.toThrow()
    await expect(rpc(anotherProspect, 'enregistrer', {
      id, libelle: 'Tentative de déplacement', date_prevue: null, annee_prevue: null,
      montant_cents: null, taux_bps: null, note: null,
    })).rejects.toThrow(/introuvable/i)
  })
})
