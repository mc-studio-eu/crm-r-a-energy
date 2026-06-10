/**
 * Protection des routes par rôle (ticket 04).
 * L'authentification de base est gérée par @nuxtjs/supabase ;
 * ici on restreint les écrans selon le rôle du profil.
 */
const ROLE_RULES: { prefix: string, roles: string[] }[] = [
  { prefix: '/admin', roles: ['admin'] },
  { prefix: '/prospects', roles: ['admin', 'telepro', 'commercial'] },
  { prefix: '/planning', roles: ['admin', 'telepro'] },
  { prefix: '/rdv', roles: ['admin', 'telepro', 'commercial'] },
]

export default defineNuxtRouteMiddleware(async (to) => {
  const user = useSupabaseUser()
  if (!user.value) return // géré par le module supabase (redirect /login)

  const rule = ROLE_RULES.find(r => to.path.startsWith(r.prefix))
  if (!rule) return

  const { profile, load } = useProfile()
  await load()

  if (!profile.value || !rule.roles.includes(profile.value.role)) {
    return navigateTo('/')
  }
})
