import { randomBytes } from 'node:crypto'

/** Lance le flow OAuth Google Calendar pour le commercial connecté. */
export default defineEventHandler(async (event) => {
  await requireRole(event, ['commercial', 'admin', 'regie_interne', 'regie_externe'])
  const config = useRuntimeConfig()
  const redirectUri = `${config.public.appUrl}/api/google/oauth/callback`
  const state = randomBytes(32).toString('hex')
  setCookie(event, 'google_oauth_state', state, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 600, path: '/api/google/oauth' })
  return sendRedirect(event, googleOAuthUrl(redirectUri, state))
})
