/**
 * Règle métier d'itinéraire (ticket 08), pure et testable :
 * temps de trajet + marge ≤ temps disponible avant le créneau, sinon refus.
 */

export interface TravelCheckInput {
  /** Fin du RDV précédent (ou maintenant si départ de la base), ISO */
  disponibleAPartirDe: string
  /** Début du créneau demandé, ISO */
  debutRdv: string
  /** Temps de trajet en minutes (résultat API itinéraire) */
  tempsTrajetMin: number
  /** Marge paramétrable par l'admin, en minutes */
  margeMin: number
}

export interface TravelCheckResult {
  ok: boolean
  tempsDisponibleMin: number
  motif?: string
}

export function checkTravelRule(input: TravelCheckInput): TravelCheckResult {
  const disponible = new Date(input.disponibleAPartirDe).getTime()
  const debut = new Date(input.debutRdv).getTime()
  const tempsDisponibleMin = Math.floor((debut - disponible) / 60_000)

  if (tempsDisponibleMin < 0) {
    return {
      ok: false,
      tempsDisponibleMin,
      motif: 'Le créneau commence avant la fin du RDV précédent',
    }
  }

  const requis = input.tempsTrajetMin + input.margeMin
  if (requis > tempsDisponibleMin) {
    return {
      ok: false,
      tempsDisponibleMin,
      motif: `Trajet de ${input.tempsTrajetMin} min + marge de ${input.margeMin} min > ${tempsDisponibleMin} min disponibles`,
    }
  }

  return { ok: true, tempsDisponibleMin }
}

/**
 * Détermine le point de départ du commercial pour un créneau donné :
 * le RDV précédent du jour s'il existe, sinon son adresse de base.
 */
export interface RdvPoint {
  fin: string
  lat: number
  lng: number
}

export function resolveDeparture(
  rdvsDuJour: RdvPoint[],
  debutRdv: string,
  base: { lat: number, lng: number } | null,
): { lat: number, lng: number, disponibleAPartirDe: string } | null {
  const debut = new Date(debutRdv).getTime()
  const precedents = rdvsDuJour
    .filter(r => new Date(r.fin).getTime() <= debut)
    .sort((a, b) => new Date(b.fin).getTime() - new Date(a.fin).getTime())

  const precedent = precedents[0]
  if (precedent) {
    return { lat: precedent.lat, lng: precedent.lng, disponibleAPartirDe: precedent.fin }
  }
  if (base) {
    // Départ de la base : on considère le commercial disponible dès maintenant,
    // ou au début de journée si le RDV est un autre jour.
    const now = new Date()
    const disponible = now.getTime() < debut ? now.toISOString() : new Date(debut).toISOString()
    return { lat: base.lat, lng: base.lng, disponibleAPartirDe: disponible }
  }
  return null
}

/** Chevauchement de deux intervalles [debut, fin) — utilisé pour le FreeBusy. */
export function overlaps(
  aDebut: string, aFin: string,
  bDebut: string, bFin: string,
): boolean {
  return new Date(aDebut) < new Date(bFin) && new Date(bDebut) < new Date(aFin)
}
