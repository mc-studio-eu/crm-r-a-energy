/**
 * Protection des routes par rôle (ticket 04).
 * L'authentification de base est gérée par @nuxtjs/supabase ;
 * ici on restreint les écrans selon le rôle du profil.
 */
const ROLE_RULES: { prefix: string, roles: string[] }[] = [
  { prefix: '/admin', roles: ['admin'] },
  { prefix: '/finances', roles: ['admin', 'commercial', 'regie_interne', 'regie_externe', 'apporteur_externe'] },
  { prefix: '/societes', roles: ['admin', 'telepro', 'commercial', 'regie_interne', 'regie_externe'] },
  { prefix: '/prospects', roles: ['admin', 'telepro', 'commercial', 'regie_interne', 'regie_externe'] },
  { prefix: '/planning', roles: ['admin', 'telepro'] },
  { prefix: '/carte', roles: ['admin', 'telepro'] },
  { prefix: '/rdv', roles: ['admin', 'telepro', 'commercial', 'regie_interne', 'regie_externe'] },
]

export default defineNuxtRouteMiddleware(async (to) => {
  const user = useSupabaseUser()
  if (!user.value) return // géré par le module supabase (redirect /login)

  const { profile, load } = useProfile()
  await load()

  if (!profile.value?.actif) {
    await useSupabaseClient().auth.signOut()
    return navigateTo('/login')
  }

  if (profile.value?.role === 'apporteur_externe' && to.path === '/') return navigateTo('/finances')
  const rule = ROLE_RULES.find(r => to.path.startsWith(r.prefix))
  if (!rule) return

  if (!rule.roles.includes(profile.value.role)) {
    return navigateTo(profile.value?.role === 'apporteur_externe' ? '/finances' : '/')
  }
})
