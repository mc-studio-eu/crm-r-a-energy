<script setup lang="ts">
import { ENERGIES, FOURNISSEURS, type Prospect, type Societe } from '~~/shared/types'

const route = useRoute()
const id = route.params.id as string
const supabase = useSupabaseClient()
const { isAdmin, isRegie, isStaff } = useProfile()

const { data, error, refresh } = await useAsyncData(`societe-${id}`, async () => {
  const { data, error } = await supabase.from('societes')
    .select('id, raison_sociale, siret')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return { societe: data as Societe | null }
})
const societe = computed(() => data.value?.societe)

type Dossier = Pick<Prospect, 'id' | 'contact_nom' | 'ville' | 'fournisseur' | 'energie' | 'date_signature' | 'statut' | 'archive'>

const PAGE_SIZE = 25
const page = ref(1)
const { data: dossiers, status: dossiersStatus, error: dossiersError } = await useAsyncData(`societe-dossiers-${id}`, async () => {
  const offset = (page.value - 1) * PAGE_SIZE
  const { data, count, error } = await supabase.from('prospects')
    .select('id, contact_nom, ville, fournisseur, energie, date_signature, statut, archive', { count: 'exact' })
    .eq('societe_id', id)
    .order('created_at', { ascending: false }).order('id')
    .range(offset, offset + PAGE_SIZE - 1)
  if (error) throw new Error(error.message)
  return { lignes: data as Dossier[], count: count ?? 0 }
}, { watch: [page] })
const totalPages = computed(() => Math.max(1, Math.ceil((dossiers.value?.count ?? 0) / PAGE_SIZE)))

const mode = ref<'modifier' | 'fusionner' | null>(null)
const identite = reactive({ raison_sociale: '', siret: '' })
const cible = ref<Societe | null>(null)
const erreurAction = ref('')
const saving = ref(false)

function ouvrir(action: typeof mode.value) {
  mode.value = mode.value === action ? null : action
  erreurAction.value = ''
  if (mode.value === 'modifier' && societe.value) {
    identite.raison_sociale = societe.value.raison_sociale
    identite.siret = societe.value.siret ?? ''
  }
  if (mode.value === 'fusionner') cible.value = null
}

async function enregistrer() {
  erreurAction.value = ''
  saving.value = true
  try {
    const { error } = await supabase.rpc('update_societe', {
      p_id: id,
      p_raison_sociale: identite.raison_sociale,
      p_siret: identite.siret,
    })
    if (error) throw error
    await refresh()
    mode.value = null
  }
  catch (error) {
    erreurAction.value = errorMessage(error, 'La société n’a pas pu être modifiée.')
  }
  finally {
    saving.value = false
  }
}

async function fusionner() {
  if (!societe.value || !cible.value) return
  const destination = cible.value
  const confirmation = `Déplacer tous les dossiers de « ${societe.value.raison_sociale} » vers « ${destination.raison_sociale} » (réf. ${destination.id.slice(-8)}) et supprimer la fiche société actuelle ?`
  if (!confirm(confirmation)) return

  erreurAction.value = ''
  saving.value = true
  try {
    const { error } = await supabase.rpc('merge_societes', { p_source: id, p_cible: destination.id })
    if (error) throw error
    await navigateTo(`/societes/${destination.id}`, { replace: true })
  }
  catch (error) {
    erreurAction.value = errorMessage(error, 'Les sociétés n’ont pas pu être fusionnées.')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="max-w-5xl">
    <NuxtLink to="/societes" class="text-sm text-gray-500 hover:text-primary">← Sociétés</NuxtLink>
    <p v-if="error" class="mt-4 text-sm text-red-600" role="alert">Le chargement de la société a échoué.</p>
    <p v-else-if="!societe" class="mt-4 text-sm text-gray-500">Société inaccessible ou introuvable.</p>
    <template v-else>
      <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl">{{ societe.raison_sociale || 'Société sans nom' }}</h1>
          <div class="mt-1 flex flex-wrap gap-x-4 text-sm text-gray-500">
            <span v-if="societe.siret">SIRET {{ societe.siret }}</span>
            <span>Réf. {{ id.slice(-8) }}</span>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <button v-if="isAdmin" type="button" class="btn-secondary" :disabled="saving" @click="ouvrir('modifier')">
            {{ mode === 'modifier' ? 'Annuler' : 'Modifier la société' }}
          </button>
          <button v-if="isAdmin" type="button" class="btn-secondary" :disabled="saving" @click="ouvrir('fusionner')">
            {{ mode === 'fusionner' ? 'Annuler la fusion' : 'Fusionner' }}
          </button>
          <NuxtLink v-if="isStaff || isRegie" :to="{ path: '/prospects/new', query: { societe: id } }" class="btn-primary">
            + Nouveau dossier pour cette société
          </NuxtLink>
        </div>
      </div>

      <form v-if="isAdmin && mode === 'modifier'" class="card mb-6 space-y-4" @submit.prevent="enregistrer">
        <div class="grid gap-4 md:grid-cols-2">
          <label>
            <span class="label">Raison sociale</span>
            <input v-model="identite.raison_sociale" required class="input">
          </label>
          <label>
            <span class="label">SIRET</span>
            <input v-model="identite.siret" inputmode="numeric" class="input">
          </label>
        </div>
        <p v-if="erreurAction" class="text-sm text-red-600" role="alert">{{ erreurAction }}</p>
        <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Enregistrement…' : 'Enregistrer' }}</button>
      </form>

      <form v-if="isAdmin && mode === 'fusionner'" class="card mb-6 space-y-3" @submit.prevent="fusionner">
        <h2 class="text-base">Société à conserver</h2>
        <p class="text-sm text-gray-600">Tous les dossiers, rendez-vous et documents resteront liés à leurs fiches. La société actuelle sera supprimée après leur rattachement.</p>
        <SocietePicker v-model="cible" :exclude-id="id" />
        <NuxtLink v-if="cible" :to="`/societes/${cible.id}`" target="_blank" class="inline-block text-sm text-primary hover:underline">
          Consulter la société sélectionnée
        </NuxtLink>
        <p v-if="erreurAction" class="text-sm text-red-600" role="alert">{{ erreurAction }}</p>
        <div>
          <button type="submit" class="btn-danger" :disabled="saving || !cible">{{ saving ? 'Fusion en cours…' : 'Fusionner les sociétés' }}</button>
        </div>
      </form>

      <div class="card">
        <h2 class="mb-2 text-base">Dossiers</h2>
        <p v-if="dossiersError" class="text-sm text-red-600" role="alert">Le chargement des dossiers a échoué.</p>
        <ul v-else-if="dossiers?.lignes.length" class="divide-y divide-gray-100">
          <li v-for="dossier in dossiers.lignes" :key="dossier.id">
            <NuxtLink :to="`/prospects/${dossier.id}`" class="flex flex-wrap items-center justify-between gap-2 py-3 text-sm hover:text-primary">
              <div>
                <p class="font-medium">
                  {{ [dossier.energie && ENERGIES[dossier.energie], dossier.fournisseur && FOURNISSEURS[dossier.fournisseur]].filter(Boolean).join(' · ') || 'Dossier' }}
                </p>
                <p class="mt-1 text-xs text-gray-500">
                  {{ [dossier.contact_nom, dossier.ville, dossier.date_signature && `Signé le ${formatContractDate(dossier.date_signature)}`, `Réf. ${dossier.id.slice(-8)}`].filter(Boolean).join(' · ') }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <span v-if="dossier.archive" class="text-xs text-gray-500">Archivé</span>
                <StatusBadge :statut="dossier.statut" />
              </div>
            </NuxtLink>
          </li>
        </ul>
        <p v-else class="py-4 text-sm text-gray-500" aria-live="polite">
          {{ dossiersStatus === 'pending' ? 'Chargement…' : 'Aucun dossier.' }}
        </p>
        <div v-if="totalPages > 1" class="mt-4 flex items-center justify-between gap-2 text-sm">
          <button type="button" class="btn-secondary" :disabled="page <= 1 || dossiersStatus === 'pending'" @click="page--">Précédent</button>
          <span class="text-gray-500">Page {{ page }} / {{ totalPages }}</span>
          <button type="button" class="btn-secondary" :disabled="page >= totalPages || dossiersStatus === 'pending'" @click="page++">Suivant</button>
        </div>
      </div>
    </template>
  </div>
</template>
