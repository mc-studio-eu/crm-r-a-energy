import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createTestDatabase, seedUser } from './helpers/database'

describe('Synchronisation des règlements fournisseur avec Finances', () => {
  let db: PGlite
  let admin: string, commercial: string, adminInactif: string

  beforeAll(async () => {
    db = await createTestDatabase()
    admin = await seedUser(db, 'admin')
    commercial = await seedUser(db, 'commercial')
    adminInactif = await seedUser(db, 'admin', { actif: false })
  }, 60000)
  afterAll(async () => { await db?.close() })

  async function scalar<T>(sql: string, args: unknown[]) {
    return (await db.query<{ value: T }>(sql, args)).rows[0]!.value
  }
  async function dossier() {
    return scalar<string>(
      "insert into public.prospects(raison_sociale,statut,date_signature) values('Règlement fournisseur finance','signe','2026-11-01') returning id as value",
      [],
    )
  }
  async function commission(prospectId: string, montantCents: number) {
    await db.query('select finance_modifier_dossier($1,$2,$3,$4)', [
      admin, prospectId, 'commission', { commission_cents: montantCents, repartitions: [] },
    ])
  }
  async function reglement(prospectId: string, options: Record<string, unknown> = {}) {
    return scalar<string>(
      'select (modifier_reglement_fournisseur($1,$2,$3,$4)->>\'id\') as value',
      [admin, prospectId, 'enregistrer', {
        libelle: 'Règlement mensuel', date_prevue: null, annee_prevue: 2026,
        montant_cents: null, taux_bps: null, note: null, ...options,
      }],
    )
  }
  async function modifier(prospectId: string, action: string, payload: Record<string, unknown>) {
    return scalar<unknown>(
      'select modifier_reglement_fournisseur($1,$2,$3,$4) as value', [admin, prospectId, action, payload],
    )
  }
  async function tableau(prospectId: string) {
    const result = await scalar<{
      lignes: { prospect_id: string, id: string, type: string, date: string, montant_cents: number }[]
    }>(
      "select finance_tableau($1,2026,11,null,null,null,null,'entree_reelle',1) as value", [admin],
    )
    return result.lignes.filter(line => line.prospect_id === prospectId)
  }

  it('synchronise une réception une seule fois et corrige le même encaissement et la même échéance', async () => {
    const prospectId = await dossier()
    await commission(prospectId, 100_000)
    const reglementId = await reglement(prospectId)

    await modifier(prospectId, 'recevoir', { id: reglementId, date_reception: '2026-11-10', montant_recu_cents: 25_000 })
    const linked = await db.query<{ due_id: string, payment_id: string, montant_cents: number }>(
      `select e.id as due_id, p.id as payment_id, p.montant_cents
       from public.finance_echeances e join public.finance_paiements p on p.echeance_id=e.id
       where e.reglement_fournisseur_id=$1`, [reglementId],
    )
    expect(linked.rows).toHaveLength(1)

    await modifier(prospectId, 'recevoir', { id: reglementId, date_reception: '2026-11-10', montant_recu_cents: 25_000 })
    let afterRepeat = await db.query<{ due_id: string, payment_id: string }>(
      `select e.id as due_id, p.id as payment_id from public.finance_echeances e
       join public.finance_paiements p on p.echeance_id=e.id where e.reglement_fournisseur_id=$1`, [reglementId],
    )
    expect(afterRepeat.rows).toEqual([{ due_id: linked.rows[0]!.due_id, payment_id: linked.rows[0]!.payment_id }])

    await modifier(prospectId, 'recevoir', { id: reglementId, date_reception: '2026-11-11', montant_recu_cents: 30_000 })
    afterRepeat = await db.query<{ due_id: string, payment_id: string }>(
      `select e.id as due_id, p.id as payment_id from public.finance_echeances e
       join public.finance_paiements p on p.echeance_id=e.id where e.reglement_fournisseur_id=$1`, [reglementId],
    )
    expect(afterRepeat.rows).toEqual([{ due_id: linked.rows[0]!.due_id, payment_id: linked.rows[0]!.payment_id }])
    expect((await db.query<{ date_paiement: string, montant_cents: number }>(
      'select date_paiement::text as date_paiement,montant_cents from public.finance_paiements where echeance_id=$1',
      [linked.rows[0]!.due_id],
    )).rows).toEqual([{ date_paiement: '2026-11-11', montant_cents: 30_000 }])
    expect(await tableau(prospectId)).toMatchObject([
      { type: 'entree_reelle', date: '2026-11-11', montant_cents: 30_000 },
    ])
    expect((await db.query('select * from public.finance_paiements where echeance_id=$1', [linked.rows[0]!.due_id])).rows)
      .toHaveLength(1)
  })

  it('annule une réception ou supprime le règlement en retirant son entrée réelle', async () => {
    const prospectId = await dossier()
    await commission(prospectId, 50_000)
    const id = await reglement(prospectId)
    await modifier(prospectId, 'recevoir', { id, date_reception: '2026-11-10', montant_recu_cents: 10_000 })
    const dueId = await scalar<string>(
      'select id as value from public.finance_echeances where reglement_fournisseur_id=$1', [id],
    )

    await modifier(prospectId, 'annuler_reception', { id })
    expect((await db.query('select * from public.finance_echeances where id=$1', [dueId])).rows).toHaveLength(0)
    expect((await db.query('select * from public.finance_paiements where echeance_id=$1', [dueId])).rows).toHaveLength(0)
    expect(await tableau(prospectId)).toEqual([])
    expect((await db.query<{ date_reception: string | null, montant_recu_cents: number | null }>(
      'select date_reception::text as date_reception,montant_recu_cents from public.prospect_reglements_fournisseur where id=$1', [id],
    )).rows[0]).toEqual({ date_reception: null, montant_recu_cents: null })

    await modifier(prospectId, 'recevoir', { id, date_reception: '2026-11-09', montant_recu_cents: 10_000 })
    const dueId2 = await scalar<string>(
      'select id as value from public.finance_echeances where reglement_fournisseur_id=$1', [id],
    )
    await modifier(prospectId, 'supprimer', { id })
    expect((await db.query('select * from public.prospect_reglements_fournisseur where id=$1', [id])).rows).toHaveLength(0)
    expect((await db.query('select * from public.finance_echeances where id=$1', [dueId2])).rows).toHaveLength(0)
    expect((await db.query('select * from public.finance_paiements where echeance_id=$1', [dueId2])).rows).toHaveLength(0)
    expect(await tableau(prospectId)).toEqual([])
  })

  it('rollback la réception sans commission ou quand le cumul reçu dépasse la commission', async () => {
    const withoutCommission = await dossier()
    const first = await reglement(withoutCommission)
    await expect(modifier(withoutCommission, 'recevoir', {
      id: first, date_reception: '2026-11-10', montant_recu_cents: 100,
    })).rejects.toThrow(/commission/i)
    expect((await db.query('select * from public.finance_echeances where reglement_fournisseur_id=$1', [first])).rows).toHaveLength(0)
    expect((await db.query<{ date_reception: string | null, montant_recu_cents: number | null }>(
      'select date_reception,montant_recu_cents from public.prospect_reglements_fournisseur where id=$1', [first],
    )).rows[0]).toMatchObject({ date_reception: null, montant_recu_cents: null })

    const capped = await dossier()
    await commission(capped, 10_000)
    const second = await reglement(capped)
    await expect(modifier(capped, 'recevoir', {
      id: second, date_reception: '2026-11-10', montant_recu_cents: 10_001,
    })).rejects.toThrow(/dépassent la commission/i)
    expect((await db.query('select * from public.finance_echeances where prospect_id=$1', [capped])).rows).toHaveLength(0)
    expect((await db.query('select * from public.finance_paiements p join public.finance_echeances e on e.id=p.echeance_id where e.prospect_id=$1', [capped])).rows).toHaveLength(0)
    expect((await db.query<{ date_reception: string | null }>(
      'select date_reception::text as date_reception from public.prospect_reglements_fournisseur where id=$1', [second],
    )).rows[0]?.date_reception).toBeNull()
  })

  it('réserve la RPC et la table directe aux administrateurs actifs, et isole les dossiers', async () => {
    const firstProspect = await dossier(), secondProspect = await dossier()
    await commission(firstProspect, 20_000)
    const id = await reglement(firstProspect)

    await expect(modifier(secondProspect, 'recevoir', {
      id, date_reception: '2026-11-10', montant_recu_cents: 5_000,
    })).rejects.toThrow(/introuvable/i)
    await expect(db.query('select modifier_reglement_fournisseur($1,$2,$3,$4)', [
      commercial, firstProspect, 'recevoir', { id, date_reception: '2026-11-10', montant_recu_cents: 5_000 },
    ])).rejects.toThrow(/administrateurs/i)
    await expect(db.query('select modifier_reglement_fournisseur($1,$2,$3,$4)', [
      adminInactif, firstProspect, 'recevoir', { id, date_reception: '2026-11-10', montant_recu_cents: 5_000 },
    ])).rejects.toThrow(/administrateurs/i)
    await expect(asUser(db, admin, () => db.query(
      `insert into public.prospect_reglements_fournisseur(prospect_id,libelle)
       values($1,'Mutation directe')`, [firstProspect],
    ))).rejects.toThrow()
    await expect(asUser(db, admin, () => db.query(
      "update public.finance_echeances set montant_cents=5000 where reglement_fournisseur_id=$1", [id],
    ))).rejects.toThrow()
    await expect(asUser(db, admin, () => db.query(
      "delete from public.prospect_reglements_fournisseur where id=$1", [id],
    ))).rejects.toThrow()

    await modifier(firstProspect, 'recevoir', { id, date_reception: '2026-11-10', montant_recu_cents: 5_000 })
    const dueId = await scalar<string>(
      'select id as value from public.finance_echeances where reglement_fournisseur_id=$1', [id],
    )
    await expect(db.query('select finance_modifier_dossier($1,$2,$3,$4)', [
      admin, firstProspect, 'echeance', { id: dueId, montant_cents: 4_000, date_prevue: '2026-11-12' },
    ])).rejects.toThrow(/règlements fournisseur/i)
    await expect(db.query('select finance_modifier_dossier($1,$2,$3,$4)', [
      admin, firstProspect, 'paiement', { echeance_id: dueId, montant_cents: 4_000, date_paiement: '2026-11-10' },
    ])).rejects.toThrow(/règlements fournisseur/i)
    expect((await db.query('select * from public.finance_paiements where echeance_id=$1', [dueId])).rows).toHaveLength(1)
  })

  it('refuse une date de réception future et conserve la ligne sans écriture', async () => {
    const prospectId = await dossier()
    await commission(prospectId, 20_000)
    const id = await reglement(prospectId)
    await expect(modifier(prospectId, 'recevoir', {
      id, date_reception: '2099-01-01', montant_recu_cents: 5_000,
    })).rejects.toThrow(/date de réception valide/i)
    expect((await db.query('select * from public.finance_echeances where reglement_fournisseur_id=$1', [id])).rows).toHaveLength(0)
    expect((await db.query('select * from public.prospect_reglements_fournisseur where id=$1 and date_reception is null', [id])).rows).toHaveLength(1)
  })
})
