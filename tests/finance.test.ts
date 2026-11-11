import { describe, expect, it } from 'vitest'
import { financeEuros, financeMontantsParTaux, financeTauxBps, MAX_FINANCE_CENTS, parseFinanceDecimal } from '../shared/finance'

describe('montants financiers', () => {
  it('convertit les décimales en entiers sans perdre de centime', () => {
    expect(parseFinanceDecimal(' 0,29 ', MAX_FINANCE_CENTS)).toBe(29)
    expect(parseFinanceDecimal('8.1', MAX_FINANCE_CENTS)).toBe(810)
    expect(parseFinanceDecimal('10000000000,00', MAX_FINANCE_CENTS)).toBe(MAX_FINANCE_CENTS)
    expect(parseFinanceDecimal('0', MAX_FINANCE_CENTS)).toBe(0)
  })

  it('refuse les écritures ambiguës ou hors plafond', () => {
    for (const value of ['', '1,234', '1e2', '-1', 'Infinity', '10000000000,01']) {
      expect(parseFinanceDecimal(value, MAX_FINANCE_CENTS)).toBeNull()
    }
    expect(parseFinanceDecimal('100,01', 10_000)).toBeNull()
  })

  it('affiche les agrégats en conservant les centimes au-delà des entiers JS sûrs', () => {
    expect(financeEuros('900719925474099301').replace(/\s/g, '')).toBe('9007199254740993,01€')
    expect(financeEuros(null)).toBe('—')
  })

  it('convertit un montant au centième de pourcentage le plus proche', () => {
    expect(financeTauxBps(30_000, 10_000)).toBe(3333)
    expect(financeTauxBps(30_000, 20_000)).toBe(6667)
    expect(financeTauxBps(100_000, 50_005)).toBe(5001)
    expect(financeTauxBps(MAX_FINANCE_CENTS, 1)).toBe(0)
    expect(financeTauxBps(0, 0)).toBe(0)
    expect(financeTauxBps(0, 1)).toBeNull()
  })

  it('prévisualise les centimes répartis en cas d’égalité et à grande échelle', () => {
    expect(financeMontantsParTaux(1, [
      { beneficiaire_id: 'b', taux_bps: 5000 }, { beneficiaire_id: 'a', taux_bps: 5000 },
    ])).toEqual([0, 1])
    // Un produit flottant ferait passer le résultat au-dessus du seuil d’arrondi.
    expect(financeMontantsParTaux(999_999_995_001, [{ beneficiaire_id: 'a', taux_bps: 9999 }])).toEqual([999_899_995_001])
  })
})
