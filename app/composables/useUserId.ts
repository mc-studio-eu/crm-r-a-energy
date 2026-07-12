/**
 * Id de l'utilisateur connecté. Selon la session Supabase, la claim
 * s'appelle `id` ou `sub` — indispensable pour les colonnes vérifiées
 * par RLS contre auth.uid() (auteur_id, uploade_par…).
 */
export function useUserId() {
  const user = useSupabaseUser()
  return computed(() => {
    const u = user.value as { id?: string, sub?: string } | null
    return u?.id ?? u?.sub ?? null
  })
}
