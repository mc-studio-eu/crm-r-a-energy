/** Déconnecte l'agenda Google du commercial. */
export default defineEventHandler(async (event) => {
  const me = await requireRole(event)
  const admin = supabaseAdmin()
  await admin
    .from('profiles')
    .update({ google_refresh_token: null, google_calendar_connected: false })
    .eq('id', me.id)
  return { ok: true }
})
