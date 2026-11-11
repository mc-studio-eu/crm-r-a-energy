import { makeImportTemplate } from '../../utils/import-workbook'
import { requireRole, supabaseAdmin } from '../../utils/supabase-admin'

export default defineEventHandler(async (event) => {
  await requireRole(event, ['admin'])
  setHeader(event, 'Cache-Control', 'private, no-store')
  const { data, error } = await supabaseAdmin().from('fournisseurs').select('nom').eq('actif', true).order('nom')
  if (error) throw createError({ statusCode: 500, message: 'Impossible de charger les fournisseurs du modèle.' })
  setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setHeader(event, 'Content-Disposition', 'attachment; filename="modele-import-dossiers.xlsx"')
  return makeImportTemplate(data)
})
