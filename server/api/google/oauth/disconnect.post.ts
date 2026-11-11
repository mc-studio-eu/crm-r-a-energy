/** Déconnecte l'agenda Google du commercial. */
export default defineEventHandler(async (event) => {
  const me = await requireRole(event)
  const admin = supabaseAdmin()
  const { error: tokenError } = await admin.from('google_credentials').delete().eq('profile_id', me.id)
  if (tokenError) throw createError({ statusCode: 500, message: 'Déconnexion impossible' })
  const { error } = await admin
    .from('profiles')
    .update({ google_calendar_connected: false })
    .eq('id', me.id)
  if (error) throw createError({ statusCode: 500, message: 'Déconnexion impossible' })
  return { ok: true }
})
