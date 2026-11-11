import type { Fournisseur } from '~~/shared/types'

export function useFournisseurs() {
  const supabase = useSupabaseClient()
  const catalogue = useAsyncData('fournisseurs', async () => {
    const { data, error } = await supabase.from('fournisseurs').select('code, nom, actif').order('nom').order('code')
    if (error) throw error
    return data as Fournisseur[]
  }, { default: () => [] })

  return catalogue
}
