<script setup lang="ts">
import type { Fournisseur, Prospect } from '~~/shared/types'

const supabase = useSupabaseClient()
const { data: fournisseurs, status: statutFournisseurs, error: erreurFournisseurs, refresh: refreshFournisseurs } = await useFournisseurs()

const nouveauFournisseur = ref('')
const editionFournisseur = ref<{ code: string, nom: string } | null>(null)
const sauvegardeFournisseur = ref(false)
const erreurMutationFournisseur = ref('')
const confirmationFournisseur = ref('')

function modifierNom(fournisseur: Fournisseur) {
  editionFournisseur.value = { code: fournisseur.code, nom: fournisseur.nom }
  erreurMutationFournisseur.value = ''
  confirmationFournisseur.value = ''
}

async function enregistrerFournisseur(changements: Partial<Pick<Fournisseur, 'nom' | 'actif'>>, code?: string) {
  if (sauvegardeFournisseur.value) return
  erreurMutationFournisseur.value = ''
  confirmationFournisseur.value = ''
  if (changements.nom === '') {
    erreurMutationFournisseur.value = 'Saisissez un nom de fournisseur.'
    return
  }

  sauvegardeFournisseur.value = true
  try {
    const { error } = code
      ? await supabase.from('fournisseurs').update(changements).eq('code', code).select('code').single()
      : await supabase.from('fournisseurs').insert(changements).select('code').single()
    if (error?.code === '23505') throw new Error('Un fournisseur porte déjà ce nom.')
    if (error) throw error

    if (!code) nouveauFournisseur.value = ''
    if (code && changements.nom !== undefined) editionFournisseur.value = null
    await refreshFournisseurs()
    confirmationFournisseur.value = 'Fournisseur enregistré.'
  } catch (error) {
    erreurMutationFournisseur.value = errorMessage(error, 'Impossible d’enregistrer le fournisseur.')
  } finally {
    sauvegardeFournisseur.value = false
  }
}

type DossierSociete = Pick<Prospect, 'id' | 'raison_sociale' | 'siret' | 'archive'>
const TAILLE_PAGE = 12
const page = ref(1)
const recherche = ref('')
const filtreSociete = ref('')
const { data: societes, status: statutSocietes, error: erreurSocietes, refresh: refreshSocietes } = await useAsyncData('referentiel-societes', async () => {
  const debut = (page.value - 1) * TAILLE_PAGE
  let query = supabase.from('prospects').select('id, raison_sociale, siret, archive', { count: 'exact' })
  const filtre = filtreSociete.value
  if (filtre) {
    const numero = filtre.replace(/\s/g, '')
    query = /^\d+$/.test(numero)
      ? query.ilike('siret', `%${numero}%`)
      : query.ilike('raison_sociale', `%${filtre.replace(/[\\%_]/g, '\\$&')}%`)
  }
  const { data, count, error } = await query.order('raison_sociale').order('id').range(debut, debut + TAILLE_PAGE - 1)
  if (error) throw error
  return { lignes: data as DossierSociete[], total: count ?? 0 }
}, { watch: [page, filtreSociete] })

watchDebounced(recherche, value => {
  page.value = 1
  filtreSociete.value = value.trim()
}, { debounce: 250 })

const totalPages = computed(() => Math.max(1, Math.ceil((societes.value?.total ?? 0) / TAILLE_PAGE)))
watch(totalPages, total => { if (page.value > total) page.value = total })

const editionSociete = ref<{ dossier: DossierSociete, nom: string, siret: string } | null>(null)
const sauvegardeSociete = ref(false)
const erreurMutationSociete = ref('')
const confirmationSociete = ref('')

function modifierSociete(dossier: DossierSociete) {
  editionSociete.value = { dossier, nom: dossier.raison_sociale, siret: dossier.siret ?? '' }
  erreurMutationSociete.value = ''
  confirmationSociete.value = ''
}

async function enregistrerSociete() {
  const edition = editionSociete.value
  if (!edition || sauvegardeSociete.value) return
  erreurMutationSociete.value = ''
  confirmationSociete.value = ''
  const raisonSociale = edition.nom.trim()
  const siret = edition.siret.replace(/\s/g, '') || null
  const siretModifie = edition.siret !== (edition.dossier.siret ?? '')
  if (!raisonSociale || (siretModifie && siret && !/^\d{14}$/.test(siret))) {
    erreurMutationSociete.value = !raisonSociale ? 'Saisissez une raison sociale.' : 'Le SIRET doit contenir 14 chiffres.'
    return
  }

  const changements: Partial<Pick<DossierSociete, 'raison_sociale' | 'siret'>> = {}
  if (raisonSociale !== edition.dossier.raison_sociale) changements.raison_sociale = raisonSociale
  if (siretModifie && siret !== edition.dossier.siret) changements.siret = siret
  if (!Object.keys(changements).length) {
    editionSociete.value = null
    return
  }

  sauvegardeSociete.value = true
  try {
    const { error } = await supabase.from('prospects').update(changements).eq('id', edition.dossier.id).select('id').single()
    if (error) throw error
    clearNuxtData(['prospects', `prospect-${edition.dossier.id}`])
    editionSociete.value = null
    await refreshSocietes()
    confirmationSociete.value = 'Identité du dossier enregistrée.'
  } catch (error) {
    erreurMutationSociete.value = errorMessage(error, 'Impossible d’enregistrer l’identité du dossier.')
  } finally {
    sauvegardeSociete.value = false
  }
}
</script>

<template>
  <div class="max-w-5xl space-y-6">
    <header>
      <h1 class="text-2xl">Référentiels</h1>
      <p class="mt-1 text-sm text-gray-600">Gérez les fournisseurs, les sociétés et les utilisateurs proposés dans le CRM.</p>
      <nav aria-label="Référentiels" class="mt-4 flex flex-wrap gap-2">
        <NuxtLink to="#fournisseurs" class="btn-secondary">Fournisseurs</NuxtLink>
        <NuxtLink to="#societes" class="btn-secondary">Sociétés</NuxtLink>
        <NuxtLink to="/admin/utilisateurs" class="btn-secondary">Équipe</NuxtLink>
        <NuxtLink to="/finances#beneficiaires" class="btn-secondary">Bénéficiaires</NuxtLink>
      </nav>
    </header>

    <section id="fournisseurs" class="card scroll-mt-20 space-y-4" aria-labelledby="titre-fournisseurs">
      <div>
        <h2 id="titre-fournisseurs" class="text-lg">Fournisseurs</h2>
        <p class="mt-1 text-sm text-gray-600">Les fournisseurs actifs sont proposés dans les dossiers et les imports. Un fournisseur désactivé reste visible dans les dossiers existants et les filtres financiers.</p>
      </div>
      <form class="flex flex-wrap items-end gap-2" @submit.prevent="enregistrerFournisseur({ nom: nouveauFournisseur.trim() })">
        <label class="min-w-48 max-w-sm flex-1">
          <span class="label">Nouveau fournisseur</span>
          <input v-model="nouveauFournisseur" class="input" required maxlength="120" :disabled="sauvegardeFournisseur">
        </label>
        <button class="btn-primary" type="submit" :disabled="sauvegardeFournisseur">Ajouter</button>
      </form>
      <p v-if="erreurMutationFournisseur" class="text-sm text-red-700" role="alert">{{ erreurMutationFournisseur }}</p>
      <p v-if="confirmationFournisseur" class="text-sm text-primary" role="status">{{ confirmationFournisseur }}</p>
      <p v-if="erreurFournisseurs" class="text-sm text-red-700" role="alert">
        Impossible de charger les fournisseurs. <button type="button" class="underline" @click="refreshFournisseurs()">Réessayer</button>
      </p>
      <p v-else-if="statutFournisseurs === 'pending'" class="text-sm text-gray-500" role="status">Chargement des fournisseurs…</p>
      <p v-else-if="!fournisseurs.length" class="text-sm text-gray-500">Aucun fournisseur.</p>
      <ul v-if="fournisseurs.length" class="divide-y divide-gray-100 border-t border-gray-100">
        <li v-for="f in fournisseurs" :key="f.code" class="py-3">
          <form v-if="editionFournisseur?.code === f.code" class="flex flex-wrap items-end gap-2" @submit.prevent="enregistrerFournisseur({ nom: editionFournisseur.nom.trim() }, f.code)">
            <label class="min-w-48 max-w-sm flex-1">
              <span class="label">Nom du fournisseur</span>
              <input v-model="editionFournisseur.nom" class="input" required maxlength="120" :disabled="sauvegardeFournisseur">
            </label>
            <button type="submit" class="btn-primary" :disabled="sauvegardeFournisseur">Enregistrer</button>
            <button type="button" class="btn-secondary" :disabled="sauvegardeFournisseur" @click="editionFournisseur = null">Annuler</button>
          </form>
          <div v-else class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="break-all text-sm font-medium">{{ f.nom }}</span>
              <span class="rounded-full px-2 py-0.5 text-xs" :class="f.actif ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-600'">{{ f.actif ? 'Actif' : 'Désactivé' }}</span>
            </div>
            <div class="flex items-center gap-4 text-sm">
              <button type="button" class="text-primary underline disabled:opacity-50" :aria-label="`Renommer ${f.nom}`" :disabled="sauvegardeFournisseur" @click="modifierNom(f)">Renommer</button>
              <button type="button" class="underline disabled:opacity-50" :class="f.actif ? 'text-red-700' : 'text-primary'" :aria-label="`${f.actif ? 'Désactiver' : 'Réactiver'} ${f.nom}`" :disabled="sauvegardeFournisseur" @click="enregistrerFournisseur({ actif: !f.actif }, f.code)">
                {{ f.actif ? 'Désactiver' : 'Réactiver' }}
              </button>
            </div>
          </div>
        </li>
      </ul>
    </section>

    <section id="societes" class="card scroll-mt-20 space-y-4" aria-labelledby="titre-societes">
      <div>
        <h2 id="titre-societes" class="text-lg">Sociétés</h2>
        <p class="mt-1 text-sm text-gray-600">Chaque société correspond à un dossier. Les changements de raison sociale et de SIRET sont enregistrés sur ce dossier.</p>
      </div>
      <label class="block max-w-sm">
        <span class="label">Raison sociale ou SIRET</span>
        <input v-model="recherche" type="search" class="input" maxlength="255" placeholder="Rechercher une société">
      </label>
      <p v-if="erreurMutationSociete" class="text-sm text-red-700" role="alert">{{ erreurMutationSociete }}</p>
      <p v-if="confirmationSociete" class="text-sm text-primary" role="status">{{ confirmationSociete }}</p>
      <p v-if="erreurSocietes" class="text-sm text-red-700" role="alert">
        Impossible de charger les sociétés. <button type="button" class="underline" @click="refreshSocietes()">Réessayer</button>
      </p>
      <p v-else-if="statutSocietes === 'pending'" class="text-sm text-gray-500" role="status">Chargement des sociétés…</p>
      <p v-else-if="!societes?.lignes.length" class="text-sm text-gray-500">Aucune société trouvée.</p>
      <ul v-else class="divide-y divide-gray-100 border-t border-gray-100">
        <li v-for="d in societes.lignes" :key="d.id" class="py-3">
          <form v-if="editionSociete?.dossier.id === d.id" class="flex flex-wrap items-end gap-2" @submit.prevent="enregistrerSociete">
            <label class="min-w-48 flex-1">
              <span class="label">Raison sociale</span>
              <input v-model="editionSociete.nom" class="input" required maxlength="255" :disabled="sauvegardeSociete">
            </label>
            <label class="w-44">
              <span class="label">SIRET</span>
              <input v-model="editionSociete.siret" inputmode="numeric" class="input" :disabled="sauvegardeSociete">
            </label>
            <button type="submit" class="btn-primary" :disabled="sauvegardeSociete">Enregistrer</button>
            <button type="button" class="btn-secondary" :disabled="sauvegardeSociete" @click="editionSociete = null">Annuler</button>
          </form>
          <div v-else class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <NuxtLink :to="`/prospects/${d.id}`" class="break-words text-sm font-medium text-primary hover:underline">{{ d.raison_sociale }}</NuxtLink>
              <p class="text-xs text-gray-600">{{ d.siret || 'SIRET non renseigné' }}{{ d.archive ? ' · Dossier archivé' : '' }}</p>
            </div>
            <button type="button" class="text-sm text-primary underline disabled:opacity-50" :aria-label="`Modifier ${d.raison_sociale}`" :disabled="sauvegardeSociete" @click="modifierSociete(d)">Modifier</button>
          </div>
        </li>
      </ul>
      <div v-if="totalPages > 1" class="flex items-center justify-center gap-3 text-sm">
        <button type="button" class="btn-secondary" :disabled="page <= 1 || statutSocietes === 'pending'" @click="page--">Précédente</button>
        <span>Page {{ page }} / {{ totalPages }}</span>
        <button type="button" class="btn-secondary" :disabled="page >= totalPages || statutSocietes === 'pending'" @click="page++">Suivante</button>
      </div>
    </section>
    <p class="text-sm text-gray-600">Les énergies, les statuts et les rôles sont définis par les règles métier du CRM.</p>
  </div>
</template>
