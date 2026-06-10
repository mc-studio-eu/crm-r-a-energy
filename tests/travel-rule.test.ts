import { describe, expect, it } from 'vitest'
import { checkTravelRule, overlaps, resolveDeparture } from '../server/utils/travel-rule'

describe('checkTravelRule — règle trajet + marge ≤ temps disponible (ticket 08)', () => {
  it('valide quand le trajet + la marge tiennent dans le temps disponible', () => {
    const res = checkTravelRule({
      disponibleAPartirDe: '2026-06-15T09:00:00Z',
      debutRdv: '2026-06-15T10:00:00Z', // 60 min disponibles
      tempsTrajetMin: 30,
      margeMin: 15, // 45 ≤ 60
    })
    expect(res.ok).toBe(true)
    expect(res.tempsDisponibleMin).toBe(60)
  })

  it('refuse quand le trajet + la marge dépassent le temps disponible', () => {
    const res = checkTravelRule({
      disponibleAPartirDe: '2026-06-15T09:30:00Z',
      debutRdv: '2026-06-15T10:00:00Z', // 30 min disponibles
      tempsTrajetMin: 25,
      margeMin: 15, // 40 > 30
    })
    expect(res.ok).toBe(false)
    expect(res.motif).toContain('25 min')
  })

  it('accepte le cas limite exact (trajet + marge = temps disponible)', () => {
    const res = checkTravelRule({
      disponibleAPartirDe: '2026-06-15T09:00:00Z',
      debutRdv: '2026-06-15T10:00:00Z',
      tempsTrajetMin: 45,
      margeMin: 15, // 60 = 60
    })
    expect(res.ok).toBe(true)
  })

  it('refuse un créneau qui commence avant la fin du RDV précédent', () => {
    const res = checkTravelRule({
      disponibleAPartirDe: '2026-06-15T11:00:00Z',
      debutRdv: '2026-06-15T10:00:00Z',
      tempsTrajetMin: 5,
      margeMin: 0,
    })
    expect(res.ok).toBe(false)
  })

  it('la marge est bien paramétrable (marge 0 vs 15)', () => {
    const base = {
      disponibleAPartirDe: '2026-06-15T09:30:00Z',
      debutRdv: '2026-06-15T10:00:00Z',
      tempsTrajetMin: 25,
    }
    expect(checkTravelRule({ ...base, margeMin: 0 }).ok).toBe(true)
    expect(checkTravelRule({ ...base, margeMin: 15 }).ok).toBe(false)
  })
})

describe('resolveDeparture — point de départ du commercial (ticket 08)', () => {
  const base = { lat: 45.76, lng: 4.85 }

  it('part du RDV précédent du jour quand il existe', () => {
    const dep = resolveDeparture(
      [
        { fin: '2026-06-15T09:00:00Z', lat: 45.7, lng: 4.8 },
        { fin: '2026-06-15T11:00:00Z', lat: 45.71, lng: 4.81 },
      ],
      '2026-06-15T14:00:00Z',
      base,
    )
    // Le plus récent avant le créneau : celui de 11 h
    expect(dep?.lat).toBe(45.71)
    expect(dep?.disponibleAPartirDe).toBe('2026-06-15T11:00:00Z')
  })

  it('ignore les RDV qui commencent après le créneau', () => {
    const dep = resolveDeparture(
      [{ fin: '2026-06-15T16:00:00Z', lat: 45.7, lng: 4.8 }],
      '2026-06-15T10:00:00Z',
      base,
    )
    expect(dep?.lat).toBe(base.lat)
  })

  it('retombe sur l\'adresse de base sans RDV précédent', () => {
    const dep = resolveDeparture([], '2026-06-15T10:00:00Z', base)
    expect(dep?.lat).toBe(base.lat)
  })

  it('renvoie null sans RDV précédent ni adresse de base', () => {
    expect(resolveDeparture([], '2026-06-15T10:00:00Z', null)).toBeNull()
  })
})

describe('overlaps — détection de conflit de créneaux (ticket 07)', () => {
  it('détecte un chevauchement partiel', () => {
    expect(overlaps(
      '2026-06-15T10:00:00Z', '2026-06-15T11:00:00Z',
      '2026-06-15T10:30:00Z', '2026-06-15T11:30:00Z',
    )).toBe(true)
  })

  it('détecte une inclusion totale', () => {
    expect(overlaps(
      '2026-06-15T10:00:00Z', '2026-06-15T12:00:00Z',
      '2026-06-15T10:30:00Z', '2026-06-15T11:00:00Z',
    )).toBe(true)
  })

  it('ne signale pas deux créneaux adjacents', () => {
    expect(overlaps(
      '2026-06-15T10:00:00Z', '2026-06-15T11:00:00Z',
      '2026-06-15T11:00:00Z', '2026-06-15T12:00:00Z',
    )).toBe(false)
  })

  it('ne signale pas deux créneaux disjoints', () => {
    expect(overlaps(
      '2026-06-15T10:00:00Z', '2026-06-15T11:00:00Z',
      '2026-06-15T14:00:00Z', '2026-06-15T15:00:00Z',
    )).toBe(false)
  })
})
