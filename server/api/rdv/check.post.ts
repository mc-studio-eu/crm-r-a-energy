import { z } from 'zod'

const bodySchema = z.object({
  prospect_id: z.string().uuid(),
  commercial_id: z.string().uuid(),
  debut: z.string().datetime({ offset: true }),
  fin: z.string().datetime({ offset: true }),
  lieu_lat: z.number(),
  lieu_lng: z.number(),
  exclude_rdv_id: z.string().uuid().optional(),
})

/** Check en direct à la sélection d'un créneau (avant validation du RDV). */
export default defineEventHandler(async (event) => {
  const me = await requireRole(event, ['admin', 'telepro', 'commercial', 'regie_interne', 'regie_externe'])
  const body = bodySchema.parse(await readBody(event))
  await requireVisibleProspect(event, body.prospect_id)
  await requireRdvIntervenant(me, body.commercial_id)
  if (['commercial', 'regie_externe'].includes(me.role) && body.commercial_id !== me.id) throw createError({ statusCode: 403, message: 'Accès refusé' })
  if (new Date(body.fin) <= new Date(body.debut)) throw createError({ statusCode: 400, message: 'Créneau invalide' })
  if (body.exclude_rdv_id) {
    const client = await serverSupabaseClient(event)
    const { data: rdv } = await client.from('rdv').select('id, prospect_id, commercial_id').eq('id', body.exclude_rdv_id).single<{ id: string, prospect_id: string, commercial_id: string }>()
    if (!rdv || rdv.prospect_id !== body.prospect_id || rdv.commercial_id !== body.commercial_id) throw createError({ statusCode: 403, message: 'RDV inaccessible' })
  }
  return await runRdvChecks({
    commercialId: body.commercial_id,
    debut: body.debut,
    fin: body.fin,
    lieuLat: body.lieu_lat,
    lieuLng: body.lieu_lng,
    excludeRdvId: body.exclude_rdv_id,
  })
})
