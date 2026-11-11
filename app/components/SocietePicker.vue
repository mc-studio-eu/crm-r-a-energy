<script setup lang="ts">
import type { Societe } from '~~/shared/types'

const props = defineProps<{ excludeId?: string }>()
const societe = defineModel<Societe | null>({ required: true })

const supabase = useSupabaseClient()
const inputId = useId()
const terme = ref('')
const { data: resultats, pending, error, refresh } = useAsyncData(
  `societe-picker-${inputId}`,
  async () => {
    let query = supabase.from('societes').select('id, raison_sociale, siret')
    const filtre = societeSearch(terme.value)
    if (filtre) query = query.ilike(filtre.champ, filtre.motif)
    if (props.excludeId) query = query.neq('id', props.excludeId)

    const { data, error } = await query.order('raison_sociale').order('id').limit(12)
    if (error) throw new Error(error.message)
    return data as Societe[]
  },
  { server: false },
)
watchDebounced(terme, () => refresh(), { debounce: 250 })
</script>

<template>
  <div v-if="societe" class="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm">
    <span>
      <span class="font-medium">{{ societe.raison_sociale || 'Société sans nom' }}</span>
      <span v-if="societe.siret" class="ml-2 text-gray-500">{{ societe.siret }}</span>
      <span class="ml-2 text-xs text-gray-500">Réf. {{ societe.id.slice(-8) }}</span>
    </span>
    <button type="button" class="text-primary hover:underline" @click="societe = null">Changer</button>
  </div>
  <div v-else class="space-y-2">
    <label :for="inputId" class="label">Rechercher une société</label>
    <input :id="inputId" v-model="terme" class="input" type="search" placeholder="Raison sociale ou SIRET">
    <p v-if="pending" class="text-sm text-gray-500" aria-live="polite">Recherche en cours…</p>
    <p v-else-if="error" class="text-sm text-red-600" role="alert">La recherche a échoué.</p>
    <ul v-else-if="resultats?.length" class="max-h-48 divide-y divide-gray-100 overflow-auto rounded-lg border border-gray-200">
      <li v-for="resultat in resultats" :key="resultat.id">
        <button
          type="button"
          class="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
          @click="societe = resultat"
        >
          <span class="font-medium">{{ resultat.raison_sociale || 'Société sans nom' }}</span>
          <span class="flex flex-wrap gap-x-3 text-xs text-gray-500">
            <span v-if="resultat.siret">{{ resultat.siret }}</span>
            <span>Réf. {{ resultat.id.slice(-8) }}</span>
          </span>
        </button>
      </li>
    </ul>
    <p v-else class="text-sm text-gray-500" aria-live="polite">Aucune société trouvée.</p>
  </div>
</template>
