export default defineEventHandler(async (event) => {
  const me = await requireRole(event, ['admin', 'telepro', 'commercial', 'regie_interne', 'regie_externe'])
  const id = getRouterParam(event, 'id')!
  const client = await serverSupabaseClient(event)
  const { data: rdv } = await client.from('rdv').select('id, prospect_id, commercial_id').eq('id', id).single<{ id: string, prospect_id: string, commercial_id: string }>()
  if (!rdv) throw createError({ statusCode: 404, message: 'RDV inaccessible' })
  await requireVisibleProspect(event, rdv.prospect_id)
  if (!['admin', 'telepro'].includes(me.role) && rdv.commercial_id !== me.id) throw createError({ statusCode: 403, message: 'Accès refusé' })
  return await syncRdvCalendar(id)
})
