import { describe, expect, it } from 'vitest'
import { financeEuros, MAX_FINANCE_CENTS, parseFinanceDecimal } from '../shared/finance'

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
})
