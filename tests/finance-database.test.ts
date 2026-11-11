import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDatabase, seedUser } from './helpers/database'

describe('Finance PostgreSQL transactions', () => {
  let db: PGlite
  let admin: string, owner: string, other: string, telepro: string, beneficiary: string, second: string
  beforeAll(async () => {
    db = await createTestDatabase()
    admin = await seedUser(db, 'admin')
    owner = await seedUser(db, 'apporteur_externe')
    other = await seedUser(db, 'apporteur_externe')
    telepro = await seedUser(db, 'telepro')
    beneficiary = await scalar('select finance_modifier_beneficiaire($1,null,\'enregistrer\',$2) as id', [admin, { nom: 'Premier', profil_id: owner, actif: true }])
    second = await scalar('select finance_modifier_beneficiaire($1,null,\'enregistrer\',$2) as id', [admin, { nom: 'Second', profil_id: other, actif: true }])
  }, 60000)
  afterAll(async () => { await db?.close() })

  async function scalar(sql: string, args: unknown[]) {
    return (await db.query<{ id: string }>(sql, args)).rows[0]!.id
  }
  async function dossier() {
    return scalar("insert into prospects(raison_sociale,statut,date_signature) values('Finance','signe','2026-11-11') returning id", [])
  }
  function mutate(id: string, action: string, payload: unknown) {
    return scalar('select finance_modifier_dossier($1,$2,$3,$4) as id', [admin, id, action, payload])
  }

  it('conserve le centime pour un partage 50/50 sur une commission de 0,01 €', async () => {
    const id = await dossier()
    await mutate(id, 'commission', { commission_cents: 1, repartitions: [{ beneficiaire_id: beneficiary, taux_bps: 5000 }, { beneficiaire_id: second, taux_bps: 5000 }] })
    const parts = await db.query<{ montant_cents: number }>('select montant_cents from finance_repartitions where prospect_id=$1', [id])
    expect(parts.rows.reduce((sum, p) => sum + Number(p.montant_cents), 0)).toBe(1)
  })

  it('refuse plus de deux bénéficiaires, doublons et pourcentages au-delà de 100 %', async () => {
    const id = await dossier()
    const part = { beneficiaire_id: beneficiary, taux_bps: 4000 }
    for (const repartitions of [[part, part, part], [part, part], [{ ...part, taux_bps: 10001 }]]) {
      await expect(mutate(id, 'commission', { commission_cents: 1000000, repartitions })).rejects.toThrow()
    }
    expect((await db.query('select * from finance_commissions where prospect_id=$1', [id])).rows).toHaveLength(0)
  })

  it('garantit les soldes avec paiements partiels, corrections et réductions de commission', async () => {
    const id = await dossier()
    await mutate(id, 'commission', { commission_cents: 1000000, repartitions: [{ beneficiaire_id: beneficiary, taux_bps: 6000 }] })
    const allocation = await scalar('select id from finance_repartitions where prospect_id=$1', [id])
    const due = await mutate(id, 'echeance', { repartition_id: allocation, montant_cents: 600000, date_prevue: '2026-11-01' })
    const payment = await mutate(id, 'paiement', { echeance_id: due, montant_cents: 200000, date_paiement: '2026-11-11' })
    await expect(mutate(id, 'paiement', { echeance_id: due, montant_cents: 400001, date_paiement: '2026-11-12' })).rejects.toThrow(/dépasse/)
    await expect(mutate(id, 'commission', { commission_cents: 200000, repartitions: [{ beneficiaire_id: beneficiary, taux_bps: 6000 }] })).rejects.toThrow(/dépassent/)
    await expect(mutate(id, 'echeance', { id: due, montant_cents: 199999, date_prevue: '2026-11-01' })).rejects.toThrow(/dépasse/)
    await mutate(id, 'paiement', { id: payment, montant_cents: 150000, date_paiement: '2026-11-11', note: 'Correction explicite' })
    await mutate(id, 'echeance', { id: due, montant_cents: 150000, date_prevue: '2026-11-01' })
    await mutate(id, 'commission', { commission_cents: 250000, repartitions: [{ beneficiaire_id: beneficiary, taux_bps: 6000 }] })
    expect(Number((await db.query<{ commission_cents: number }>('select commission_cents from finance_commissions where prospect_id=$1', [id])).rows[0]?.commission_cents)).toBe(250000)
    expect((await db.query('select * from finance_audit where prospect_id=$1 and action=\'paiement\'', [id])).rows).toHaveLength(2)
    await db.query("update prospects set statut='perdu' where id=$1", [id])
    expect((await db.query('select * from finance_paiements where id=$1', [payment])).rows).toHaveLength(1)
  })

  it('refuse aux non-admins les mutations même via le service', async () => {
    const id = await dossier()
    await expect(db.query('select finance_modifier_dossier($1,$2,\'commission\',$3)', [owner, id, { commission_cents: 100, repartitions: [] }])).rejects.toThrow(/administrateurs/)
    await expect(db.query('select finance_lire_dossier($1,$2)', [telepro, id])).rejects.toThrow(/administrateurs/)
  })

  it('isole chaque dossier lors des corrections de paiements', async () => {
    const id = await dossier(), another = await dossier()
    await mutate(id, 'commission', { commission_cents: 100, repartitions: [] })
    const due = await mutate(id, 'echeance', { montant_cents: 100, date_prevue: '2026-11-01' })
    const payment = await mutate(id, 'paiement', { echeance_id: due, montant_cents: 20, date_paiement: '2026-11-11' })
    await expect(mutate(another, 'paiement', { id: payment, montant_cents: 10, date_paiement: '2026-11-11' })).rejects.toThrow(/introuvable/)
  })

  it('calcule la part R&A mensuelle et la masque avec un filtre bénéficiaire', async () => {
    const id = await dossier()
    await mutate(id, 'commission', {
      commission_cents: 20001,
      repartitions: [{ beneficiaire_id: beneficiary, taux_bps: 3333, fonction: 'Apporteur' }, { beneficiaire_id: second, taux_bps: 0, fonction: 'Commercial' }],
    })
    async function lignes(filtre: string | null) {
      return (await db.query<{ result: { lignes: { prospect_id: string, type: string, montant_cents: number }[] } }>(
        'select finance_tableau($1,2026,11,null,null,null,$2,null,1) as result', [admin, filtre],
      )).rows[0]!.result.lignes.filter(l => l.prospect_id === id)
    }
    expect((await lignes(null)).find(l => l.type === 'part_ra')?.montant_cents).toBe(13335)
    expect((await lignes(second)).map(l => [l.type, l.montant_cents])).toEqual([['part_signee', 0]])
  })

  it('conserve les échéances en retard et le bilan personnel hors période sélectionnée', async () => {
    const id = await dossier()
    await mutate(id, 'commission', { commission_cents: 1000, repartitions: [{ beneficiaire_id: beneficiary, taux_bps: 5000 }] })
    const allocation = await scalar('select id from finance_repartitions where prospect_id=$1', [id])
    const due = await mutate(id, 'echeance', { repartition_id: allocation, montant_cents: 450, date_prevue: '2020-02-01' })
    await mutate(id, 'paiement', { echeance_id: due, montant_cents: 150, date_paiement: '2020-02-02' })
    const result = (await db.query<{ result: {
      lignes: unknown[]
      dossiers: { prospect_id: string, montant_cents: number, paye_cents: number, reste_cents: number, retard_cents: number, prochaine_echeance: string }[]
    } }>('select finance_tableau($1,2040,5,null,null,null,null,null,1) as result', [owner])).rows[0]!.result
    expect(result.lignes).toEqual([])
    expect(result.dossiers.find(d => d.prospect_id === id)).toMatchObject({
      montant_cents: 500, paye_cents: 150, reste_cents: 350, retard_cents: 300, prochaine_echeance: '2020-02-01',
    })
  })

  it('le tableau personnel expose seulement ses parts signées, jamais l’assiette ni les autres parts', async () => {
    const id = await dossier()
    await mutate(id, 'commission', { commission_cents: 1234500, repartitions: [{ beneficiaire_id: beneficiary, taux_bps: 6000 }, { beneficiaire_id: second, taux_bps: 4000 }] })
    async function dashboard(actor: string) {
      return (await db.query<{ result: { lignes: { prospect_id: string, type: string, montant_cents: number }[], dossiers: { prospect_id: string, montant_cents: number }[] } }>(
        'select finance_tableau($1,2026,null,null,null,null,null,null,1) as result', [actor],
      )).rows[0]!.result
    }
    const personal = await dashboard(owner)
    const line = personal.lignes.find(l => l.prospect_id === id)
    expect(line?.type).toBe('part_signee')
    expect(Number(line?.montant_cents)).toBe(740700)
    expect(JSON.stringify(personal)).not.toContain('taux_bps')
    expect(JSON.stringify(personal)).not.toContain('commission_cents')
    expect(JSON.stringify(personal)).not.toContain('Second')
    expect(personal.lignes.some(l => l.type === 'signature' || l.type === 'entree_reelle')).toBe(false)
    expect(Number((await dashboard(other)).dossiers.find(d => d.prospect_id === id)?.montant_cents)).toBe(493800)
    // Missing signature dates stay out of monthly graphs but don't hide the signed dossier.
    await db.query('update prospects set date_signature=null where id=$1', [id])
    expect((await dashboard(owner)).dossiers.some(d => d.prospect_id === id)).toBe(true)
    await db.query("update prospects set statut='en_cours' where id=$1", [id])
    expect((await dashboard(owner)).dossiers.some(d => d.prospect_id === id)).toBe(false)
    await expect(dashboard(telepro)).rejects.toThrow()
    await db.query('update profiles set actif=false where id=$1', [owner])
    await expect(dashboard(owner)).rejects.toThrow()
  })
})
