import type { Profile } from '~~/shared/types'

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
    if (profile.value?.id === user.value.id) return
    const { data } = await supabase
      .from('profiles')
      .select('id, role, nom, telephone, adresse_depart, depart_lat, depart_lng, actif, google_calendar_connected')
      .eq('id', user.value.id)
      .single()
    profile.value = data
  }

  const isAdmin = computed(() => profile.value?.role === 'admin')
  const isStaff = computed(() => profile.value?.role === 'admin' || profile.value?.role === 'telepro')

  return { profile, load, isAdmin, isStaff }
}
