export default defineEventHandler(async (event) => {
  await requireRole(event, ['admin'])
  const admin = supabaseAdmin()

  const { data: profiles, error } = await admin
    .from('profiles')
    .select('id, role, nom, telephone, actif, adresse_depart, google_calendar_connected, created_at')
    .order('created_at')
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const emails = new Map(users.map(u => [u.id, u.email]))

  return profiles.map(p => ({ ...p, email: emails.get(p.id) ?? null }))
})
