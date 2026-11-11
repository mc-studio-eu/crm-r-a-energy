export default defineEventHandler(async (event) => {
  const acteur = await requireRole(event, ['admin'])
  const payload = validerFinance(financeBeneficiaireSchema, await readBody(event))
  const { data, error } = await supabaseAdmin().rpc('finance_modifier_beneficiaire', {
    p_acteur: acteur.id, p_id: null, p_action: 'enregistrer', p_payload: payload,
  })
  if (error) leverErreurFinance(error)
  return { id: data as string }
})
