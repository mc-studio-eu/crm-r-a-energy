export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  await requireRole(event, ['admin'])
  const client = supabaseAdmin()
  const [societes, beneficiaires, commerciaux] = await Promise.all([
    client.from('prospects').select('societe_id, raison_sociale').order('raison_sociale'),
    client.from('finance_beneficiaires').select('id, nom').eq('est_ra_energy', false).order('nom'),
    client.from('profiles').select('id, nom').in('role', ['commercial', 'regie_interne', 'regie_externe']).order('nom'),
  ])
  if (societes.error) leverErreurFinance(societes.error)
  if (beneficiaires.error) leverErreurFinance(beneficiaires.error)
  if (commerciaux.error) leverErreurFinance(commerciaux.error)
  return {
    societes: (societes.data ?? []).map(dossier => ({ id: dossier.societe_id, raison_sociale: dossier.raison_sociale })),
    beneficiaires: beneficiaires.data ?? [],
    commerciaux: commerciaux.data ?? [],
  }
})
