/** Callback OAuth Google : stocke le refresh token du commercial (ticket 07). */
export default defineEventHandler(async (event) => {
  const me = await requireRole(event, ['commercial', 'admin'])
  const { code, state } = getQuery<{ code?: string, state?: string }>(event)

  if (!code || state !== me.id) {
    return sendRedirect(event, '/profil?calendar=error')
  }

  const config = useRuntimeConfig()
  const redirectUri = `${config.public.appUrl}/api/google/oauth/callback`
  const tokens = await exchangeCodeForTokens(code, redirectUri)

  if (!tokens.refresh_token) {
    return sendRedirect(event, '/profil?calendar=error')
  }

  const admin = supabaseAdmin()
  await admin
    .from('profiles')
    .update({ google_refresh_token: tokens.refresh_token, google_calendar_connected: true })
    .eq('id', me.id)

  return sendRedirect(event, '/profil?calendar=connected')
})
