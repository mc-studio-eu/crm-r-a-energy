/** Lance le flow OAuth Google Calendar pour le commercial connecté (ticket 07). */
export default defineEventHandler(async (event) => {
  const me = await requireRole(event, ['commercial', 'admin', 'regie_interne'])
  const config = useRuntimeConfig()
  const redirectUri = `${config.public.appUrl}/api/google/oauth/callback`
  // state = user id signé naïvement avec le début de la clé service role ;
  // suffisant ici car le callback revalide la session de toute façon.
  return sendRedirect(event, googleOAuthUrl(redirectUri, me.id))
})
