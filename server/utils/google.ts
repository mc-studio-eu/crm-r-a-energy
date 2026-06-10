/**
 * Intégration Google (tickets 07 + 08) via REST — pas de SDK lourd.
 * - OAuth 2.0 par commercial (refresh token stocké dans profiles, service role only)
 * - FreeBusy : check de dispo en temps réel
 * - Events : création / mise à jour / suppression dans l'agenda du commercial
 * - Routes API : temps de trajet voiture (avec cache mémoire)
 */

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const ROUTES_API = 'https://routes.googleapis.com/directions/v2:computeRoutes'
const GEOCODE_API = 'https://maps.googleapis.com/maps/api/geocode/json'

export function googleOAuthUrl(redirectUri: string, state: string) {
  const config = useRuntimeConfig()
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy',
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const config = useRuntimeConfig()
  return await $fetch<{ access_token: string, refresh_token?: string }>(GOOGLE_TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
}

/** Rafraîchit l'access token ; lève une erreur 409 si le token est révoqué/expiré. */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const config = useRuntimeConfig()
  try {
    const res = await $fetch<{ access_token: string }>(GOOGLE_TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        grant_type: 'refresh_token',
      }),
    })
    return res.access_token
  }
  catch {
    throw createError({
      statusCode: 409,
      statusMessage: 'Agenda Google non connecté ou autorisation expirée',
    })
  }
}

/** FreeBusy : renvoie les créneaux occupés du commercial sur la fenêtre donnée. */
export async function getBusySlots(accessToken: string, timeMin: string, timeMax: string) {
  const res = await $fetch<{ calendars: { primary?: { busy: { start: string, end: string }[] } } }>(
    `${CALENDAR_API}/freeBusy`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: { timeMin, timeMax, items: [{ id: 'primary' }] },
    },
  )
  return res.calendars.primary?.busy ?? []
}

export interface CalendarEventInput {
  summary: string
  description?: string
  location?: string
  start: string
  end: string
}

export async function createCalendarEvent(accessToken: string, input: CalendarEventInput) {
  return await $fetch<{ id: string }>(`${CALENDAR_API}/calendars/primary/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: {
      summary: input.summary,
      description: input.description,
      location: input.location,
      start: { dateTime: input.start },
      end: { dateTime: input.end },
    },
  })
}

export async function updateCalendarEvent(accessToken: string, eventId: string, input: CalendarEventInput) {
  return await $fetch(`${CALENDAR_API}/calendars/primary/events/${eventId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: {
      summary: input.summary,
      description: input.description,
      location: input.location,
      start: { dateTime: input.start },
      end: { dateTime: input.end },
    },
  })
}

export async function deleteCalendarEvent(accessToken: string, eventId: string) {
  await $fetch(`${CALENDAR_API}/calendars/primary/events/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => { /* event déjà supprimé côté Google : non bloquant */ })
}

// ---------- Itinéraire (ticket 08) ----------

// Cache mémoire simple pour limiter les coûts API (clé arrondie à ~100 m, TTL 1 h)
const routeCache = new Map<string, { value: number, expires: number }>()
const ROUTE_CACHE_TTL_MS = 60 * 60 * 1000

function cacheKey(oLat: number, oLng: number, dLat: number, dLng: number) {
  const r = (n: number) => n.toFixed(3)
  return `${r(oLat)},${r(oLng)}->${r(dLat)},${r(dLng)}`
}

/** Temps de trajet voiture en minutes via Google Routes API. */
export async function getDriveTimeMinutes(
  origin: { lat: number, lng: number },
  destination: { lat: number, lng: number },
): Promise<number> {
  const key = cacheKey(origin.lat, origin.lng, destination.lat, destination.lng)
  const cached = routeCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.value

  const config = useRuntimeConfig()
  const res = await $fetch<{ routes?: { duration: string }[] }>(ROUTES_API, {
    method: 'POST',
    headers: {
      'X-Goog-Api-Key': config.googleMapsApiKey,
      'X-Goog-FieldMask': 'routes.duration',
    },
    body: {
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
    },
  })

  const duration = res.routes?.[0]?.duration // ex. "1234s"
  if (!duration) {
    throw createError({ statusCode: 502, statusMessage: 'Itinéraire introuvable' })
  }
  const minutes = Math.ceil(Number.parseInt(duration) / 60)
  routeCache.set(key, { value: minutes, expires: Date.now() + ROUTE_CACHE_TTL_MS })
  return minutes
}

/** Géocodage d'une adresse (ticket 05). */
export async function geocodeAddress(adresse: string) {
  const config = useRuntimeConfig()
  const res = await $fetch<{
    results: { geometry: { location: { lat: number, lng: number } }, formatted_address: string }[]
    status: string
  }>(GEOCODE_API, {
    params: { address: adresse, region: 'fr', key: config.googleMapsApiKey },
  })
  const first = res.results?.[0]
  if (res.status !== 'OK' || !first) {
    return null
  }
  return {
    lat: first.geometry.location.lat,
    lng: first.geometry.location.lng,
    formatted: first.formatted_address,
  }
}
