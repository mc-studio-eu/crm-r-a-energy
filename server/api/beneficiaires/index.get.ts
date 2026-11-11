import type { FinanceAnnuaire } from '~~/shared/finance'

export default defineEventHandler(async (event): Promise<FinanceAnnuaire> => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  await requireRole(event, ['admin'])
  const client = supabaseAdmin()
  const [beneficiaires, profils] = await Promise.all([
    client.from('finance_beneficiaires').select('id, nom, profil_id, actif, est_ra_energy').order('nom'),
    getQuery(event).profils === '1'
      ? client.from('profiles').select('id, nom').order('nom')
      : Promise.resolve({ data: [], error: null }),
  ])
  if (beneficiaires.error) leverErreurFinance(beneficiaires.error)
  if (profils.error) leverErreurFinance(profils.error)
  return { beneficiaires: beneficiaires.data ?? [], profils: profils.data ?? [] }
})
