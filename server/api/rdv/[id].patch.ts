import { z } from 'zod'

const bodySchema = z.object({
  statut: z.enum(['planifie', 'honore', 'annule', 'no_show']).optional(),
  debut: z.string().datetime({ offset: true }).optional(),
  fin: z.string().datetime({ offset: true }).optional(),
  lieu: z.string().optional(),
  lieu_lat: z.number().optional(),
  lieu_lng: z.number().optional(),
  notes: z.string().optional(),
})

/** Modification / annulation d'un RDV + synchronisation Google Calendar (ticket 07). */
export default defineEventHandler(async (event) => {
  const me = await requireRole(event)
  const id = getRouterParam(event, 'id')!
  const body = bodySchema.parse(await readBody(event))
  const admin = supabaseAdmin()

  const { data: rdv } = await admin
    .from('rdv')
    .select('*, prospects(raison_sociale)')
    .eq('id', id)
    .single()
  if (!rdv) throw createError({ statusCode: 404, statusMessage: 'RDV introuvable' })

  // Un commercial ne modifie que ses propres RDV (les staff modifient tout)
  if (me.role === 'commercial' && rdv.commercial_id !== me.id) {
    throw createError({ statusCode: 403, statusMessage: 'Accès refusé' })
  }

  // Re-check si le créneau change
  const debut = body.debut ?? rdv.debut
  const fin = body.fin ?? rdv.fin
  if ((body.debut || body.fin) && (body.statut ?? rdv.statut) === 'planifie') {
    const checks = await runRdvChecks({
      commercialId: rdv.commercial_id,
      debut,
      fin,
      lieuLat: body.lieu_lat ?? rdv.lieu_lat,
      lieuLng: body.lieu_lng ?? rdv.lieu_lng,
      excludeRdvId: id,
    })
    if (!checks.ok) {
      throw createError({ statusCode: 422, statusMessage: 'Créneau refusé', data: checks })
    }
  }

  const { error } = await admin.from('rdv').update(body).eq('id', id)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  // Sync Google Calendar
  if (rdv.google_event_id) {
    const { data: commercial } = await admin
      .from('profiles')
      .select('google_refresh_token, google_calendar_connected')
      .eq('id', rdv.commercial_id)
      .single()

    if (commercial?.google_calendar_connected && commercial.google_refresh_token) {
      try {
        const accessToken = await refreshAccessToken(commercial.google_refresh_token)
        if (body.statut === 'annule') {
          await deleteCalendarEvent(accessToken, rdv.google_event_id)
          await admin.from('rdv').update({ google_event_id: null }).eq('id', id)
        }
        else if (body.debut || body.fin || body.lieu) {
          await updateCalendarEvent(accessToken, rdv.google_event_id, {
            summary: `RDV — ${rdv.prospects?.raison_sociale ?? 'Prospect'}`,
            location: body.lieu ?? rdv.lieu,
            start: debut,
            end: fin,
          })
        }
      }
      catch { /* sync non bloquante */ }
    }
  }

  return { ok: true }
})
