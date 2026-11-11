<script setup lang="ts">
import type { Societe } from '~~/shared/types'

const supabase = useSupabaseClient()
const { isStaff, isRegie } = useProfile()
const page = ref(1)
const terme = ref('')
const filtre = debouncedRef(terme, 250)
const PAGE_SIZE = 25

watch(filtre, () => { page.value = 1 })
const { data, status, error } = await useAsyncData('societes', async () => {
  let query = supabase.from('societes').select('id, raison_sociale, siret', { count: 'exact' })
  const recherche = societeSearch(filtre.value)
  if (recherche) query = query.ilike(recherche.champ, recherche.motif)

  const offset = (page.value - 1) * PAGE_SIZE
  const { data, count, error } = await query.order('raison_sociale').order('id').range(offset, offset + PAGE_SIZE - 1)
  if (error) throw new Error(error.message)
  return { societes: data as Societe[], count: count ?? 0 }
}, { watch: [page, filtre] })
const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.count ?? 0) / PAGE_SIZE)))
</script>

<template>
  <div class="max-w-5xl">
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl">Sociétés</h1>
      <NuxtLink v-if="isStaff || isRegie" to="/prospects/new" class="btn-primary">+ Nouveau dossier</NuxtLink>
    </div>

    <label class="mb-4 block max-w-md">
      <span class="label">Rechercher une société</span>
      <input v-model="terme" type="search" class="input" placeholder="Raison sociale ou SIRET">
    </label>

    <p v-if="error" class="card text-sm text-red-600" role="alert">Le chargement des sociétés a échoué.</p>
    <div v-else class="card">
      <ul v-if="data?.societes.length" class="divide-y divide-gray-100">
        <li v-for="societe in data.societes" :key="societe.id">
          <NuxtLink
            :to="`/societes/${societe.id}`"
            class="flex flex-wrap items-center justify-between gap-2 py-3 text-sm hover:text-primary"
          >
            <span class="font-medium">{{ societe.raison_sociale || 'Société sans nom' }}</span>
            <span class="flex flex-wrap items-center gap-x-4 text-xs text-gray-500">
              <span v-if="societe.siret">SIRET {{ societe.siret }}</span>
              <span>Réf. {{ societe.id.slice(-8) }}</span>
            </span>
          </NuxtLink>
        </li>
      </ul>
      <p v-else class="py-5 text-center text-sm text-gray-500" aria-live="polite">
        {{ status === 'pending' ? 'Chargement…' : 'Aucune société trouvée.' }}
      </p>
    </div>

    <div v-if="totalPages > 1" class="mt-4 flex items-center justify-between gap-2 text-sm">
      <button type="button" class="btn-secondary" :disabled="page <= 1 || status === 'pending'" @click="page--">Précédent</button>
      <span class="text-gray-500">Page {{ page }} / {{ totalPages }}</span>
      <button type="button" class="btn-secondary" :disabled="page >= totalPages || status === 'pending'" @click="page++">Suivant</button>
    </div>
  </div>
</template>
