import type { FinanceDossier } from '~~/shared/finance'

export default defineEventHandler(async (event): Promise<FinanceDossier> => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const acteur = await requireRole(event, ['admin'])
  const id = financeIdentifiant(getRouterParam(event, 'id'))
  const { data, error } = await supabaseAdmin().rpc('finance_lire_dossier', { p_acteur: acteur.id, p_prospect: id })
  if (error) leverErreurFinance(error)
  return data as FinanceDossier
})
