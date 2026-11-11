export default defineEventHandler(async (event) => {
  const acteur = await requireRole(event, ['admin'])
  const id = financeIdentifiant(getRouterParam(event, 'id'))
  const payload = validerFinance(financeBeneficiaireSchema, await readBody(event))
  const { error } = await supabaseAdmin().rpc('finance_modifier_beneficiaire', {
    p_acteur: acteur.id, p_id: id, p_action: 'enregistrer', p_payload: payload,
  })
  if (error) leverErreurFinance(error)
  return { id }
})
