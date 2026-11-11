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
  qualification: z.enum(['R1', 'R2']).nullable().optional(),
})

/**
 * Création d'un RDV (ticket 06) : checks bloquants (07 + 08), puis insertion
 * et création de l'événement dans le Google Agenda du commercial.
 */
export default defineEventHandler(async (event) => {
  const me = await requireRole(event, ['admin', 'telepro', 'regie_interne'])
  const body = bodySchema.parse(await readBody(event))

  // La régie interne ne place des RDV que pour elle-même.
  if (me.role === 'regie_interne' && body.commercial_id !== me.id) {
    throw createError({ statusCode: 403, message: 'Accès refusé' })
  }
  const admin = supabaseAdmin()
  await requireVisibleProspect(event, body.prospect_id)
  await requireRdvIntervenant(me, body.commercial_id)
  if (new Date(body.fin) <= new Date(body.debut)) throw createError({ statusCode: 400, message: 'La fin doit suivre le début' })

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

  const sync = await syncRdvCalendar(rdv.id)

  // Historique sur la fiche prospect
  await admin.from('prospect_activites').insert({
    prospect_id: body.prospect_id,
    auteur_id: me.id,
    type: 'rdv',
    detail: `RDV planifié le ${new Date(body.debut).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`,
  })

  return { rdv, checks, sync }
})
