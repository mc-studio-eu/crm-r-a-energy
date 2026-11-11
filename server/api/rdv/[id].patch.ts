import { z } from 'zod'

const bodySchema = z.object({
  statut: z.enum(['planifie', 'honore', 'annule', 'no_show']).optional(),
  debut: z.string().datetime({ offset: true }).optional(),
  fin: z.string().datetime({ offset: true }).optional(),
  lieu: z.string().optional(),
  lieu_lat: z.number().optional(),
  lieu_lng: z.number().optional(),
  notes: z.string().optional(),
  qualification: z.enum(['R1', 'R2']).nullable().optional(),
})

/** Modification / annulation d'un RDV + synchronisation Google Calendar (ticket 07). */
export default defineEventHandler(async (event) => {
  const me = await requireRole(event, ['admin', 'telepro', 'commercial', 'regie_interne', 'regie_externe'])
  const id = getRouterParam(event, 'id')!
  const body = bodySchema.parse(await readBody(event))
  const admin = supabaseAdmin()

  const { data: rdv } = await admin
    .from('rdv')
    .select('*, prospects(raison_sociale)')
    .eq('id', id)
    .single()
  if (!rdv) throw createError({ statusCode: 404, message: 'RDV introuvable' })

  // Seul le staff modifie les RDV des autres ; les autres rôles uniquement les leurs.
  if (!['admin', 'telepro'].includes(me.role) && rdv.commercial_id !== me.id) {
    throw createError({ statusCode: 403, message: 'Accès refusé' })
  }

  await requireVisibleProspect(event, rdv.prospect_id)

  // Re-check si le créneau change
  const debut = body.debut ?? rdv.debut
  const fin = body.fin ?? rdv.fin
  if (new Date(fin) <= new Date(debut)) throw createError({ statusCode: 400, message: 'Créneau invalide' })
  if ((body.debut || body.fin || body.lieu_lat !== undefined || body.lieu_lng !== undefined || body.statut === 'planifie') && (body.statut ?? rdv.statut) === 'planifie') {
    await requireRdvIntervenant(me, rdv.commercial_id)
    const checks = await runRdvChecks({
      commercialId: rdv.commercial_id,
      debut,
      fin,
      lieuLat: body.lieu_lat ?? rdv.lieu_lat,
      lieuLng: body.lieu_lng ?? rdv.lieu_lng,
      excludeRdvId: id,
    })
    if (!checks.ok) {
      throw createError({ statusCode: 422, message: 'Créneau refusé', data: checks })
    }
  }

  const { error } = await admin.from('rdv').update(body).eq('id', id)
  if (error) throw createError({ statusCode: 500, message: error.message })

  const sync = await syncRdvCalendar(id)
  return { ok: true, sync }
})
