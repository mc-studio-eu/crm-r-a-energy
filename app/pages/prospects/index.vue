<script setup lang="ts">
import { PROSPECT_STATUTS, type Prospect, type ProspectStatut } from '~~/shared/types'

const supabase = useSupabaseClient()
const { isStaff } = useProfile()

const PAGE_SIZE = 25
const page = ref(1)
const search = ref('')
const filtreStatut = ref<ProspectStatut | ''>('')
const filtreCommercial = ref('')
const filtreVille = ref('')
const tri = ref<'updated_at' | 'raison_sociale' | 'created_at'>('updated_at')

const { data: commerciaux } = await useAsyncData('commerciaux', async () => {
  const { data } = await supabase
    .from('profiles')
    .select('id, nom')
    .eq('role', 'commercial')
    .eq('actif', true)
    .order('nom')
  return data ?? []
})

const { data, refresh } = await useAsyncData('prospects', async () => {
  let query = supabase
    .from('prospects')
    .select('*', { count: 'exact' })
    .eq('archive', false)

  if (search.value) {
    query = query.or(`raison_sociale.ilike.%${search.value}%,contact_nom.ilike.%${search.value}%,siret.ilike.%${search.value}%`)
  }
  if (filtreStatut.value) query = query.eq('statut', filtreStatut.value)
  if (filtreCommercial.value) query = query.eq('assigne_a', filtreCommercial.value)
  if (filtreVille.value) {
    query = query.or(`ville.ilike.%${filtreVille.value}%,code_postal.like.${filtreVille.value}%`)
  }

  const from = (page.value - 1) * PAGE_SIZE
  const { data: rows, count } = await query
    .order(tri.value, { ascending: tri.value === 'raison_sociale' })
    .range(from, from + PAGE_SIZE - 1)

  return { rows: (rows ?? []) as Prospect[], count: count ?? 0 }
}, { watch: [page, filtreStatut, filtreCommercial, tri] })

watchDebounced([search, filtreVille], () => {
  page.value = 1
  refresh()
}, { debounce: 300 })

const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.count ?? 0) / PAGE_SIZE)))

const nomCommercial = (id: string | null) =>
  displayName(commerciaux.value?.find(c => c.id === id)?.nom)

/** Changement de statut en 1 clic depuis la liste (historisé par trigger BDD). */
async function setStatut(prospect: Prospect, statut: ProspectStatut) {
  await supabase.from('prospects').update({ statut }).eq('id', prospect.id)
  refresh()
}
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl">Prospects <span class="text-base font-normal text-gray-400">({{ data?.count }})</span></h1>
      <NuxtLink v-if="isStaff" to="/prospects/new" class="btn-primary">+ Nouveau prospect</NuxtLink>
    </div>

    <!-- Filtres -->
    <div class="mb-4 grid gap-3 md:grid-cols-5">
      <input v-model="search" type="search" placeholder="Recherche (nom, contact, SIRET)…" class="input md:col-span-2">
      <select v-model="filtreStatut" class="input">
        <option value="">Tous les statuts</option>
        <option v-for="(label, s) in PROSPECT_STATUTS" :key="s" :value="s">{{ label }}</option>
      </select>
      <select v-model="filtreCommercial" class="input">
        <option value="">Tous les commerciaux</option>
        <option v-for="c in commerciaux" :key="c.id" :value="c.id">{{ displayName(c.nom) }}</option>
      </select>
      <input v-model="filtreVille" type="search" placeholder="Ville ou CP" class="input">
    </div>

    <div class="card overflow-x-auto !p-0">
      <table class="table-base">
        <thead>
          <tr>
            <th class="cursor-pointer" @click="tri = 'raison_sociale'">Entreprise</th>
            <th>Contact</th>
            <th>Ville</th>
            <th>Statut</th>
            <th>Commercial</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in data?.rows" :key="p.id" class="hover:bg-secondary-light/30">
            <td>
              <NuxtLink :to="`/prospects/${p.id}`" class="font-medium text-primary hover:underline">
                {{ p.raison_sociale }}
              </NuxtLink>
            </td>
            <td>{{ p.contact_nom }}<br><span class="text-xs text-gray-500">{{ p.telephone }}</span></td>
            <td>{{ p.ville }} <span class="text-xs text-gray-400">{{ p.code_postal }}</span></td>
            <td><StatusBadge :statut="p.statut" /></td>
            <td>{{ nomCommercial(p.assigne_a) }}</td>
            <td>
              <select
                class="rounded border border-gray-200 px-1 py-0.5 text-xs"
                :value="p.statut"
                @change="setStatut(p, ($event.target as HTMLSelectElement).value as any)"
              >
                <option v-for="(label, s) in PROSPECT_STATUTS" :key="s" :value="s">{{ label }}</option>
              </select>
            </td>
          </tr>
          <tr v-if="!data?.rows.length">
            <td colspan="6" class="py-10 text-center text-gray-400">Aucun prospect ne correspond aux filtres.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="mt-4 flex items-center justify-center gap-3 text-sm">
      <button class="btn-secondary !px-3 !py-1" :disabled="page <= 1" @click="page--">←</button>
      <span>Page {{ page }} / {{ totalPages }}</span>
      <button class="btn-secondary !px-3 !py-1" :disabled="page >= totalPages" @click="page++">→</button>
    </div>
  </div>
</template>
