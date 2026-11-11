/** Callback OAuth Google : stocke le refresh token du commercial (ticket 07). */
export default defineEventHandler(async (event) => {
  const me = await requireRole(event, ['commercial', 'admin', 'regie_interne', 'regie_externe'])
  const { code, state } = getQuery<{ code?: string, state?: string }>(event)

  const expectedState = getCookie(event, 'google_oauth_state')
  deleteCookie(event, 'google_oauth_state', { path: '/api/google/oauth' })
  if (!code || !expectedState || state !== expectedState) {
    return sendRedirect(event, '/profil?calendar=error')
  }

  const config = useRuntimeConfig()
  const redirectUri = `${config.public.appUrl}/api/google/oauth/callback`
  const tokens = await exchangeCodeForTokens(code, redirectUri)

  if (!tokens.refresh_token) {
    return sendRedirect(event, '/profil?calendar=error')
  }

  const admin = supabaseAdmin()
  const { error: tokenError } = await admin.from('google_credentials').upsert({ profile_id: me.id, refresh_token: tokens.refresh_token })
  if (tokenError) return sendRedirect(event, '/profil?calendar=error')
  const { error } = await admin
    .from('profiles')
    .update({ google_calendar_connected: true })
    .eq('id', me.id)

  return sendRedirect(event, error ? '/profil?calendar=error' : '/profil?calendar=connected')
})
