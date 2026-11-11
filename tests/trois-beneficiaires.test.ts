import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDatabase, seedUser } from './helpers/database'

describe('Répartition entre trois bénéficiaires', () => {
  let db: PGlite
  let admin: string
  let beneficiaires: string[]
  beforeAll(async () => {
    db = await createTestDatabase()
    admin = await seedUser(db, 'admin')
    beneficiaires = []
    for (const nom of ['Premier', 'Deuxième', 'Troisième', 'Quatrième']) {
      const { rows } = await db.query<{ id: string }>(
        "select finance_modifier_beneficiaire($1,null,'enregistrer',$2) as id",
        [admin, { nom, actif: true }],
      )
      beneficiaires.push(rows[0]!.id)
    }
  }, 60000)
  afterAll(async () => { await db?.close() })

  async function enregistrer(parts: Record<string, unknown>[]) {
    const { rows } = await db.query<{ id: string }>("insert into prospects(raison_sociale) values('Trois bénéficiaires') returning id")
    const id = rows[0]!.id
    await db.query("select finance_modifier_dossier($1,$2,'commission',$3)", [admin, id, {
      commission_cents: 120000, repartitions: parts,
    }])
    return (await db.query<{ montant_cents: number }>(
      'select montant_cents from finance_repartitions where prospect_id=$1 order by montant_cents', [id],
    )).rows.map(row => Number(row.montant_cents))
  }

  it('enregistre trois parts avec pourcentages et montant fixe', async () => {
    expect(await enregistrer([
      { beneficiaire_id: beneficiaires[0], taux_bps: 1500, fonction: 'Télépro' },
      { beneficiaire_id: beneficiaires[1], taux_bps: 5000, fonction: 'Commercial' },
      { beneficiaire_id: beneficiaires[2], montant_cents: 12000, fonction: 'Apporteur' },
    ])).toEqual([12000, 18000, 60000])
  })

  it('refuse un quatrième bénéficiaire même quand le total reste inférieur à la commission', async () => {
    await expect(enregistrer(beneficiaires.map(beneficiaire_id => ({ beneficiaire_id, taux_bps: 1000 }))))
      .rejects.toThrow(/trois bénéficiaires au maximum/)
  })

  it('refuse trois parts dont le total dépasse la commission', async () => {
    await expect(enregistrer(beneficiaires.slice(0, 3).map(beneficiaire_id => ({ beneficiaire_id, taux_bps: 4000 }))))
      .rejects.toThrow(/100 %/)
  })
})
