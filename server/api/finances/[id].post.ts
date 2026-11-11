export default defineEventHandler(async (event) => {
  const acteur = await requireRole(event, ['admin'])
  const id = financeIdentifiant(getRouterParam(event, 'id'))
  const { action, ...payload } = validerFinance(financeActionSchema, await readBody(event))
  const { data, error } = await supabaseAdmin().rpc('finance_modifier_dossier', {
    p_acteur: acteur.id,
    p_prospect: id,
    p_action: action,
    p_payload: payload,
  })
  if (error) leverErreurFinance(error)
  return { id: data as string }
})
