import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { MAX_FINANCE_CENTS, type FinanceDossier, type FinanceTableau } from '../shared/finance'
import { asUser, createTestDatabase, seedUser } from './helpers/database'

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
  async function lire(id: string) {
    return (await db.query<{ result: FinanceDossier }>('select finance_lire_dossier($1,$2) as result', [admin, id])).rows[0]!.result
  }

  it('conserve le centime pour un partage 50/50 sur une commission de 0,01 €', async () => {
    const id = await dossier()
    await mutate(id, 'commission', { commission_cents: 1, repartitions: [{ beneficiaire_id: beneficiary, taux_bps: 5000 }, { beneficiaire_id: second, taux_bps: 5000 }] })
    const parts = await db.query<{ montant_cents: number }>('select montant_cents from finance_repartitions where prospect_id=$1', [id])
    expect(parts.rows.reduce((sum, p) => sum + Number(p.montant_cents), 0)).toBe(1)
  })

  it('refuse les doublons et pourcentages au-delà de 100 %', async () => {
    const id = await dossier()
    const part = { beneficiaire_id: beneficiary, taux_bps: 4000 }
    for (const repartitions of [[part, part, part], [part, part], [{ ...part, taux_bps: 10001 }]]) {
      await expect(mutate(id, 'commission', { commission_cents: 1000000, repartitions })).rejects.toThrow()
    }
    expect((await db.query('select * from finance_commissions where prospect_id=$1', [id])).rows).toHaveLength(0)
  })

  it('conserve le montant exact et son mode de saisie avec une part au taux', async () => {
    const id = await dossier()
    const repartitions = [{ beneficiaire_id: beneficiary, montant_cents: 1 }, { beneficiaire_id: second, taux_bps: 2500 }]
    await mutate(id, 'commission', { commission_cents: MAX_FINANCE_CENTS, repartitions })
    expect((await lire(id)).repartitions).toMatchObject([
      { taux_bps: 0, montant_cents: 1, saisie_montant: true },
      { taux_bps: 2500, montant_cents: MAX_FINANCE_CENTS / 4, saisie_montant: false },
    ])
    await mutate(id, 'commission', { commission_cents: 7, repartitions })
    expect((await lire(id)).repartitions).toMatchObject([
      { taux_bps: 1429, montant_cents: 1, saisie_montant: true },
      { taux_bps: 2500, montant_cents: 2, saisie_montant: false },
    ])
  })

  it('borne la somme des centimes sans additionner les taux calculés', async () => {
    const id = await dossier()
    await mutate(id, 'commission', {
      commission_cents: 100_000,
      repartitions: [{ beneficiaire_id: beneficiary, montant_cents: 50_005 }, { beneficiaire_id: second, montant_cents: 49_995 }],
    })
    expect((await lire(id)).repartitions).toMatchObject([
      { montant_cents: 50_005, taux_bps: 5001 }, { montant_cents: 49_995, taux_bps: 5000 },
    ])
    await expect(mutate(id, 'commission', {
      commission_cents: 100,
      repartitions: [{ beneficiaire_id: beneficiary, montant_cents: 51 }, { beneficiaire_id: second, taux_bps: 5000 }],
    })).rejects.toThrow(/dépasser la commission totale/)
    expect((await lire(id)).commission_cents).toBe(100_000)
    await mutate(id, 'commission', { commission_cents: 0, repartitions: [{ beneficiaire_id: beneficiary, montant_cents: 0 }] })
    expect((await lire(id)).repartitions).toMatchObject([{ montant_cents: 0, taux_bps: 0, saisie_montant: true }])
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

  it('conserve la part interne dans R&A Energy sans la compter parmi les reversements', async () => {
    const id = await scalar("insert into prospects(raison_sociale,statut,date_signature) values('Finance RA','signe','2020-11-11') returning id", [])
    const societe = await scalar('select societe_id as id from prospects where id=$1', [id])
    function modifierBeneficiaire(identifiant: string | null, action: string, payload: unknown) {
      return scalar('select finance_modifier_beneficiaire($1,$2,$3,$4) as id', [admin, identifiant, action, payload])
    }
    const ra = await modifierBeneficiaire(null, 'enregistrer', { nom: 'R&A', profil_id: null, actif: true, est_ra_energy: true })
    await mutate(id, 'commission', { commission_cents: 120_000, repartitions: [
      { beneficiaire_id: beneficiary, montant_cents: 30_000 },
      { beneficiaire_id: second, montant_cents: 0 },
      { beneficiaire_id: ra, montant_cents: 90_000 },
    ] })
    const avant = await lire(id)
    const partInterne = avant.repartitions.find(p => p.beneficiaire_id === ra)!
    const partExterne = avant.repartitions.find(p => p.beneficiaire_id === beneficiary)!
    expect(partInterne.est_ra_energy).toBe(false)
    expect(avant.part_ra_cents).toBe(0)

    const historique = await mutate(id, 'echeance', { repartition_id: partInterne.id, montant_cents: 20_000, date_prevue: '2020-11-01' })
    const ancienPaiement = await mutate(id, 'paiement', { echeance_id: historique, montant_cents: 5_000, date_paiement: '2020-11-02' })
    const reversement = await mutate(id, 'echeance', { repartition_id: partExterne.id, montant_cents: 30_000, date_prevue: '2020-11-03' })
    await mutate(id, 'paiement', { echeance_id: reversement, montant_cents: 10_000, date_paiement: '2020-11-04' })

    await db.query('update finance_beneficiaires set est_ra_energy=true where id=$1', [ra])
    await modifierBeneficiaire(ra, 'enregistrer', { nom: 'R&A Energy', profil_id: null, actif: true })
    const apres = await lire(id)
    expect(apres.part_ra_cents).toBe(90_000)
    expect(apres.repartitions).toEqual(avant.repartitions.map(p => p.id === partInterne.id
      ? { ...p, beneficiaire: 'R&A Energy', est_ra_energy: true }
      : p))
    expect(apres.echeances.find(e => e.id === historique)?.paiements).toMatchObject([{ id: ancienPaiement, montant_cents: 5_000 }])
    await expect(mutate(id, 'echeance', { repartition_id: partInterne.id, montant_cents: 100, date_prevue: '2020-11-11' })).rejects.toThrow(/ne fait pas l’objet d’un reversement/)
    await expect(mutate(id, 'paiement', { echeance_id: historique, montant_cents: 100, date_paiement: '2020-11-11' })).rejects.toThrow(/ne fait pas l’objet d’un reversement/)
    await mutate(id, 'paiement', { id: ancienPaiement, montant_cents: 4_000, date_paiement: '2020-11-02' })

    async function dashboard(actor = admin, filtre: string | null = null) {
      return (await db.query<{ result: FinanceTableau }>(
        'select finance_tableau($1,2020,11,$2,null,null,$3,null,1) as result', [actor, societe, filtre],
      )).rows[0]!.result
    }
    const general = await dashboard()
    expect(general.lignes.map(l => [l.type, l.montant_cents])).toEqual([
      ['part_ra', 90_000], ['part_signee', expect.any(Number)], ['part_signee', expect.any(Number)], ['signature', 120_000],
      ['sortie_reelle', 10_000], ['sortie_prevue', 30_000],
    ])
    expect(general.mois.find(m => m.type === 'part_signee')).toMatchObject({ nombre: 2, montant_cents: '30000' })
    expect(general.retards_admin?.reversement_cents).toBe('20000')
    expect((await dashboard(admin, ra)).lignes).toEqual([])
    const personnel = await dashboard(owner)
    expect(personnel.dossiers).toMatchObject([{ prospect_id: id, montant_cents: 30_000, paye_cents: 10_000 }])
    expect(personnel.lignes.map(l => l.type)).toEqual(['part_signee', 'sortie_reelle', 'sortie_prevue'])

    await db.query('update prospects set date_signature=null where id=$1', [id])
    expect((await dashboard()).lignes.some(l => l.type === 'part_ra')).toBe(false)
    expect((await lire(id)).part_ra_cents).toBe(90_000)
    await db.query("update prospects set statut='en_cours', date_signature='2020-11-11' where id=$1", [id])
    expect((await dashboard()).lignes.some(l => l.type === 'part_ra')).toBe(false)

    await expect(modifierBeneficiaire(ra, 'enregistrer', { nom: 'R&A Energy', profil_id: owner, actif: true })).rejects.toThrow(/compte personnel/)
    await expect(modifierBeneficiaire(ra, 'supprimer', {})).rejects.toThrow(/ne peut pas être supprimé/)
    const homonyme = await modifierBeneficiaire(null, 'enregistrer', { nom: 'R&A Energy', profil_id: null, actif: true })
    await expect(db.query('update finance_beneficiaires set est_ra_energy=true where id=$1', [homonyme])).rejects.toThrow(/un_seul_ra_energy/)
    await expect(db.query('update finance_beneficiaires set profil_id=$1 where id=$2', [owner, ra])).rejects.toThrow(/ra_sans_profil/)
    await expect(asUser(db, admin, () => db.query('select finance_lire_dossier($1,$2)', [admin, id]))).rejects.toThrow(/permission denied/)
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
