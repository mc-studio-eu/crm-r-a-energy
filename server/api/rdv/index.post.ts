import { z } from 'zod'

const bodySchema = z.object({
  prospect_id: z.string().uuid(),
  commercial_id: z.string().uuid(),
  debut: z.string().datetime({ offset: true }),
  fin: z.string().datetime({ offset: true }),
  lieu: z.string().min(1),
  lieu_lat: z.number(),
  lieu_lng: z.number(),
  notes: z.string().optional(),
})

/**
 * Création d'un RDV (ticket 06) : checks bloquants (07 + 08), puis insertion
 * et création de l'événement dans le Google Agenda du commercial.
 */
export default defineEventHandler(async (event) => {
  const me = await requireRole(event, ['admin', 'telepro'])
  const body = bodySchema.parse(await readBody(event))
  const admin = supabaseAdmin()
  const config = useRuntimeConfig()

  // Checks bloquants : un RDV refusé n'est pas créé
  const checks = await runRdvChecks({
    commercialId: body.commercial_id,
    debut: body.debut,
    fin: body.fin,
    lieuLat: body.lieu_lat,
    lieuLng: body.lieu_lng,
  })
  if (!checks.ok) {
    throw createError({ statusCode: 422, message: 'Créneau refusé', data: checks })
  }

  const { data: prospect } = await admin
    .from('prospects').select('raison_sociale').eq('id', body.prospect_id).single()

  const { data: rdv, error } = await admin
    .from('rdv')
    .insert({
      ...body,
      statut: 'planifie',
      temps_trajet_min: checks.trajet.tempsTrajetMin,
      cree_par: me.id,
    })
    .select()
    .single()
  if (error) throw createError({ statusCode: 500, message: error.message })

  // Event Google Calendar (non bloquant si l'agenda n'est pas connecté)
  const { data: commercial } = await admin
    .from('profiles')
    .select('google_refresh_token, google_calendar_connected')
    .eq('id', body.commercial_id)
    .single()

  if (commercial?.google_calendar_connected && commercial.google_refresh_token) {
    try {
      const accessToken = await refreshAccessToken(commercial.google_refresh_token)
      const gEvent = await createCalendarEvent(accessToken, {
        summary: `RDV — ${prospect?.raison_sociale ?? 'Prospect'}`,
        description: `Fiche prospect : ${config.public.appUrl}/prospects/${body.prospect_id}`,
        location: body.lieu,
        start: body.debut,
        end: body.fin,
      })
      await admin.from('rdv').update({ google_event_id: gEvent.id }).eq('id', rdv.id)
      rdv.google_event_id = gEvent.id
    }
    catch {
      // L'échec de sync calendrier ne doit pas annuler le RDV créé
    }
  }

  // Historique sur la fiche prospect
  await admin.from('prospect_activites').insert({
    prospect_id: body.prospect_id,
    auteur_id: me.id,
    type: 'rdv',
    detail: `RDV planifié le ${new Date(body.debut).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`,
  })

  return { rdv, checks }
})
