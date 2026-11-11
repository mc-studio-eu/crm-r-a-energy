import { makeImportTemplate } from '../../utils/import-workbook'
import { requireRole } from '../../utils/supabase-admin'

export default defineEventHandler(async (event) => {
  await requireRole(event, ['admin'])
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setHeader(event, 'Content-Disposition', 'attachment; filename="modele-import-dossiers.xlsx"')
  return makeImportTemplate()
})
