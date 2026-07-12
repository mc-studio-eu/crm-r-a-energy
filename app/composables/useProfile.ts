import type { Profile } from '~~/shared/types'

type SupabaseAuthState = {
  id?: string
  sub?: string
}

function getUserId(user: unknown) {
  if (!user || typeof user !== 'object') return null
  const authState = user as SupabaseAuthState
  return authState.id ?? authState.sub ?? null
}

/** Profil de l'utilisateur connecté (rôle, nom…), chargé une fois et partagé. */
export function useProfile() {
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  const profile = useState<Profile | null>('profile', () => null)

  async function load() {
    if (!user.value) {
      profile.value = null
      return
    }
    const userId = getUserId(user.value)
    if (!userId) {
      profile.value = null
      return
    }
    if (profile.value?.id === userId) return
    const { data } = await supabase
      .from('profiles')
      .select('id, role, nom, telephone, adresse_depart, depart_lat, depart_lng, actif, google_calendar_connected')
      .eq('id', userId)
      .single()
    profile.value = data
  }

  const isAdmin = computed(() => profile.value?.role === 'admin')
  const isStaff = computed(() => profile.value?.role === 'admin' || profile.value?.role === 'telepro')
  const isRegie = computed(() => profile.value?.role === 'regie_interne' || profile.value?.role === 'regie_externe')

  return { profile, load, isAdmin, isStaff, isRegie }
}
