import type { ReglementFournisseur } from '~~/shared/reglements-fournisseur'

export default defineEventHandler(async (event): Promise<{ id: string } | ReglementFournisseur> => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const acteur = await requireRole(event, ['admin'])
  const prospectId = identifiantDossierReglement(getRouterParam(event, 'id'))
  const result = actionReglementFournisseurSchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, message: 'Vérifiez le libellé, les dates et les montants du règlement.' })
  }
  const { action, ...payload } = result.data
  const { data, error } = await supabaseAdmin().rpc('modifier_reglement_fournisseur', {
    p_acteur: acteur.id, p_prospect: prospectId, p_action: action, p_payload: payload,
  })
  if (error) leverErreurReglementFournisseur(error)
  return data
})
