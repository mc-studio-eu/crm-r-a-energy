export default defineEventHandler(async (event) => {
  const acteur = await requireRole(event, ['admin'])
  const id = financeIdentifiant(getRouterParam(event, 'id'))
  const { error } = await supabaseAdmin().rpc('finance_modifier_beneficiaire', {
    p_acteur: acteur.id, p_id: id, p_action: 'supprimer', p_payload: {},
  })
  if (error) leverErreurFinance(error)
  return { id }
})
