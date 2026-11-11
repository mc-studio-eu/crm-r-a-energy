import type { FinanceTableau } from '~~/shared/finance'
import { FINANCE_ROLES } from '~~/shared/types'

export default defineEventHandler(async (event): Promise<FinanceTableau> => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const acteur = await requireRole(event, FINANCE_ROLES)
  const query = validerFinance(financeQuerySchema, getQuery(event))
  const admin = acteur.role === 'admin'
  const { data, error } = await supabaseAdmin().rpc('finance_tableau', {
    p_acteur: acteur.id,
    p_annee: query.annee,
    p_mois: query.mois ?? null,
    p_societe: query.societe ?? null,
    p_fournisseur: query.fournisseur ?? null,
    p_energie: query.energie ?? null,
    p_beneficiaire: admin ? query.beneficiaire ?? null : null,
    p_type: query.type ?? null,
    p_page: query.page,
    p_commercial: admin ? query.commercial ?? null : null,
    p_dossiers_page: query.dossiers_page,
  })
  if (error) leverErreurFinance(error)
  return { ...(data as Omit<FinanceTableau, 'admin'>), admin }
})
