import type { ReglementFournisseur } from '~~/shared/reglements-fournisseur'

export default defineEventHandler(async (event): Promise<ReglementFournisseur[]> => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  await requireRole(event, ['admin'])
  const id = identifiantDossierReglement(getRouterParam(event, 'id'))
  const client = await serverSupabaseClient(event)
  const { data, error } = await client.from('prospect_reglements_fournisseur')
    .select(COLONNES_REGLEMENT_FOURNISSEUR)
    .eq('prospect_id', id)
    .order('created_at')
    .order('id')
  if (error) leverErreurReglementFournisseur(error)
  return data ?? []
})
