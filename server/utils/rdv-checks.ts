import type { RdvCheckResult } from '~~/shared/types'
import { checkTravelRule, resolveDeparture, overlaps } from './travel-rule'

export interface RdvCheckParams {
  commercialId: string
  debut: string
  fin: string
  lieuLat: number
  lieuLng: number
  /** RDV à exclure des checks (cas d'une modification) */
  excludeRdvId?: string
}

/**
 * Checks combinés à la prise de RDV (tickets 07 + 08) :
 * 1. dispo Google Calendar (FreeBusy) + conflits RDV internes
 * 2. règle d'itinéraire : trajet + marge ≤ temps disponible
 */
export async function runRdvChecks(params: RdvCheckParams): Promise<RdvCheckResult> {
  const admin = supabaseAdmin()

  const { data: commercial } = await admin
    .from('profiles')
    .select('id, google_refresh_token, google_calendar_connected, depart_lat, depart_lng')
    .eq('id', params.commercialId)
    .single()
  if (!commercial) {
    throw createError({ statusCode: 404, statusMessage: 'Commercial introuvable' })
  }

  // Marge paramétrable (admin)
  const { data: setting } = await admin
    .from('app_settings').select('value').eq('key', 'marge_trajet_min').single()
  const margeMin = Number(setting?.value ?? 15)

  // ---- 1. Disponibilité ----
  let dispoOk = true
  let conflit: { debut: string, fin: string } | null = null

  // Conflits avec les RDV internes déjà planifiés
  const jour = params.debut.slice(0, 10)
  const { data: rdvsDuJour } = await admin
    .from('rdv')
    .select('id, debut, fin, lieu_lat, lieu_lng')
    .eq('commercial_id', params.commercialId)
    .eq('statut', 'planifie')
    .gte('debut', `${jour}T00:00:00Z`)
    .lte('debut', `${jour}T23:59:59Z`)

  const autresRdv = (rdvsDuJour ?? []).filter(r => r.id !== params.excludeRdvId)
  for (const r of autresRdv) {
    if (overlaps(params.debut, params.fin, r.debut, r.fin)) {
      dispoOk = false
      conflit = { debut: r.debut, fin: r.fin }
      break
    }
  }

  // Google Calendar FreeBusy si l'agenda est connecté
  if (dispoOk && commercial.google_calendar_connected && commercial.google_refresh_token) {
    const accessToken = await refreshAccessToken(commercial.google_refresh_token)
    const busy = await getBusySlots(accessToken, params.debut, params.fin)
    const conflitGoogle = busy.find(b => overlaps(params.debut, params.fin, b.start, b.end))
    if (conflitGoogle) {
      dispoOk = false
      conflit = { debut: conflitGoogle.start, fin: conflitGoogle.end }
    }
  }

  // ---- 2. Itinéraire ----
  const base = commercial.depart_lat != null && commercial.depart_lng != null
    ? { lat: commercial.depart_lat, lng: commercial.depart_lng }
    : null

  const departure = resolveDeparture(
    autresRdv
      .filter(r => r.lieu_lat != null && r.lieu_lng != null)
      .map(r => ({ fin: r.fin, lat: r.lieu_lat!, lng: r.lieu_lng! })),
    params.debut,
    base,
  )

  let trajet: RdvCheckResult['trajet'] = {
    ok: true,
    tempsTrajetMin: null,
    tempsDisponibleMin: null,
    margeMin,
    motif: departure ? undefined : 'Pas de point de départ connu (adresse de base non renseignée) — check itinéraire ignoré',
  }

  if (departure) {
    const tempsTrajetMin = await getDriveTimeMinutes(
      { lat: departure.lat, lng: departure.lng },
      { lat: params.lieuLat, lng: params.lieuLng },
    )
    const rule = checkTravelRule({
      disponibleAPartirDe: departure.disponibleAPartirDe,
      debutRdv: params.debut,
      tempsTrajetMin,
      margeMin,
    })
    trajet = { ok: rule.ok, tempsTrajetMin, tempsDisponibleMin: rule.tempsDisponibleMin, margeMin, motif: rule.motif }

    // Trajet vers le RDV suivant si existant
    if (rule.ok) {
      const suivant = autresRdv
        .filter(r => new Date(r.debut) >= new Date(params.fin) && r.lieu_lat != null && r.lieu_lng != null)
        .sort((a, b) => new Date(a.debut).getTime() - new Date(b.debut).getTime())[0]
      if (suivant) {
        const versSuivantMin = await getDriveTimeMinutes(
          { lat: params.lieuLat, lng: params.lieuLng },
          { lat: suivant.lieu_lat!, lng: suivant.lieu_lng! },
        )
        const ruleSuivant = checkTravelRule({
          disponibleAPartirDe: params.fin,
          debutRdv: suivant.debut,
          tempsTrajetMin: versSuivantMin,
          margeMin,
        })
        if (!ruleSuivant.ok) {
          trajet = {
            ok: false,
            tempsTrajetMin,
            tempsDisponibleMin: ruleSuivant.tempsDisponibleMin,
            margeMin,
            motif: `RDV suivant inatteignable : ${ruleSuivant.motif}`,
          }
        }
      }
    }
  }

  return {
    ok: dispoOk && trajet.ok,
    disponibilite: { ok: dispoOk, conflit },
    trajet,
  }
}
