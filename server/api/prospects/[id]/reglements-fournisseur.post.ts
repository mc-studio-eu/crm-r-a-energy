import type { ReglementFournisseur } from '~~/shared/reglements-fournisseur'

export default defineEventHandler(async (event): Promise<{ id: string } | ReglementFournisseur> => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  await requireRole(event, ['admin'])
  const prospectId = identifiantDossierReglement(getRouterParam(event, 'id'))
  const result = actionReglementFournisseurSchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, message: 'Vérifiez le libellé, les dates et les montants du règlement.' })
  }
  const client = await serverSupabaseClient(event)
  const table = client.from('prospect_reglements_fournisseur')
  if (result.data.action === 'supprimer') {
    const { data, error } = await table.delete().eq('prospect_id', prospectId).eq('id', result.data.id)
      .select('id').maybeSingle()
    if (error) leverErreurReglementFournisseur(error)
    if (!data) throw createError({ statusCode: 404, message: 'Règlement introuvable dans ce dossier.' })
    return data
  }

  const { action: _action, id, ...champs } = result.data
  const mutation = id
    ? table.update(champs).eq('prospect_id', prospectId).eq('id', id)
    : table.insert({ ...champs, prospect_id: prospectId })
  const { data, error } = await mutation.select(COLONNES_REGLEMENT_FOURNISSEUR).maybeSingle()
  if (error) leverErreurReglementFournisseur(error)
  if (!data) throw createError({ statusCode: 404, message: 'Règlement introuvable dans ce dossier.' })
  return data
})
