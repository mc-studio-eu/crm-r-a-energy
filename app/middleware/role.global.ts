import { FINANCE_ROLES, type UserRole } from '~~/shared/types'

/**
 * Protection des routes par rôle (ticket 04).
 * L'authentification de base est gérée par @nuxtjs/supabase ;
 * ici on restreint les écrans selon le rôle du profil.
 */
const ROLE_RULES: { prefix: string, roles: UserRole[] }[] = [
  { prefix: '/admin', roles: ['admin'] },
  { prefix: '/finances', roles: FINANCE_ROLES },
  { prefix: '/societes', roles: ['admin', 'administratif', 'telepro', 'commercial', 'regie_interne', 'regie_externe'] },
  { prefix: '/prospects', roles: ['admin', 'administratif', 'telepro', 'commercial', 'regie_interne', 'regie_externe'] },
  { prefix: '/planning', roles: ['admin', 'telepro'] },
  { prefix: '/carte', roles: ['admin', 'telepro'] },
  { prefix: '/rdv', roles: ['admin', 'telepro', 'commercial', 'regie_interne', 'regie_externe'] },
]

export default defineNuxtRouteMiddleware(async (to) => {
  const user = useSupabaseUser()
  if (!user.value) return // géré par le module supabase (redirect /login)

  const { profile, isAdministratif, load } = useProfile()
  await load()

  if (!profile.value?.actif) {
    await useSupabaseClient().auth.signOut()
    return navigateTo('/login')
  }

  const path = to.path.toLowerCase().replace(/\/+$/, '') || '/'
  if (profile.value.role === 'apporteur_externe' && path === '/') return navigateTo('/finances')
  if (isAdministratif.value && (path === '/' || path === '/prospects/new')) return navigateTo('/prospects')
  const rule = ROLE_RULES.find(r => path === r.prefix || path.startsWith(`${r.prefix}/`))
  if (!rule) return

  if (!rule.roles.includes(profile.value.role)) {
    return navigateTo(isAdministratif.value ? '/prospects' : profile.value.role === 'apporteur_externe' ? '/finances' : '/')
  }
})
