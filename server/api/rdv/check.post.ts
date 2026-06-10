import { z } from 'zod'

const bodySchema = z.object({
  commercial_id: z.string().uuid(),
  debut: z.string().datetime({ offset: true }),
  fin: z.string().datetime({ offset: true }),
  lieu_lat: z.number(),
  lieu_lng: z.number(),
  exclude_rdv_id: z.string().uuid().optional(),
})

/** Check en direct à la sélection d'un créneau (avant validation du RDV). */
export default defineEventHandler(async (event) => {
  await requireRole(event, ['admin', 'telepro'])
  const body = bodySchema.parse(await readBody(event))
  return await runRdvChecks({
    commercialId: body.commercial_id,
    debut: body.debut,
    fin: body.fin,
    lieuLat: body.lieu_lat,
    lieuLng: body.lieu_lng,
    excludeRdvId: body.exclude_rdv_id,
  })
})
