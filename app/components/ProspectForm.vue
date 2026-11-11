<script setup lang="ts">
import {
  ASSIGNABLE_ROLES, ENERGIES, FOURNISSEURS, PROSPECT_STATUTS,
  type Energie, type Fournisseur, type Prospect, type ProspectStatut,
} from '~~/shared/types'

const props = defineProps<{ prospect?: Prospect | null }>()
const emit = defineEmits<{ saved: [id: string] }>()

const supabase = useSupabaseClient()
const userId = useUserId()
const { profile } = useProfile()
const statut = ref<ProspectStatut>('en_cours')

const form = reactive({
  contact_nom: props.prospect?.contact_nom ?? '',
  telephone: props.prospect?.telephone ?? '',
  email: props.prospect?.email ?? '',
  adresse: props.prospect?.adresse ?? '',
  code_postal: props.prospect?.code_postal ?? '',
  ville: props.prospect?.ville ?? '',
  teleprospecteur_id: props.prospect?.teleprospecteur_id
    ?? (profile.value?.role === 'telepro' ? profile.value.id : ''),
  fournisseur: (props.prospect?.fournisseur ?? '') as Fournisseur | '',
  energie: (props.prospect?.energie ?? '') as Energie | '',
  date_signature: props.prospect?.date_signature ?? '',
  debut_livraison: props.prospect?.debut_livraison ?? '',
  fin_livraison: props.prospect?.fin_livraison ?? '',
  source: props.prospect?.source ?? '',
  scoring_entreprise: props.prospect?.scoring_entreprise ?? '',
  notes: props.prospect?.notes ?? '',
  assigne_a: props.prospect?.assigne_a ?? '',
})
const identite = reactive({ raison_sociale: props.prospect?.raison_sociale ?? '', siret: props.prospect?.siret ?? '' })

const { data: commerciaux } = await useAsyncData('form-commerciaux', async () => {
  const { data } = await supabase
    .from('profiles').select('id, nom').in('role', ASSIGNABLE_ROLES).eq('actif', true).order('nom')
  return data ?? []
})

const { data: teleprospecteurs } = await useAsyncData('form-teleprospecteurs', async () => {
  const { data } = await supabase
    .from('profiles').select('id, nom').eq('role', 'telepro').eq('actif', true).order('nom')
  return data ?? []
})

const saving = ref(false)
const error = ref('')
const geocodeWarning = ref('')

const siretLoading = ref(false)
const siretError = ref('')

interface EntrepriseSuggestion {
  raison_sociale: string
  siret: string
  adresse: string
  code_postal: string
  ville: string
}
const entrepriseSuggestions = ref<EntrepriseSuggestion[]>([])
const entrepriseOpen = ref(false)
let entrepriseTimer: ReturnType<typeof setTimeout> | null = null

function onRaisonSocialeInput() {
  if (entrepriseTimer) clearTimeout(entrepriseTimer)
  const q = identite.raison_sociale.trim()
  if (q.length < 3) {
    entrepriseSuggestions.value = []
    entrepriseOpen.value = false
    return
  }
  entrepriseTimer = setTimeout(async () => {
    try {
      entrepriseSuggestions.value = await $fetch('/api/entreprise', { query: { q } })
      entrepriseOpen.value = entrepriseSuggestions.value.length > 0
    }
    catch {
      entrepriseSuggestions.value = []
      entrepriseOpen.value = false
    }
  }, 250)
}

function choisirEntreprise(s: EntrepriseSuggestion) {
  identite.raison_sociale = s.raison_sociale
  if (s.siret) identite.siret = s.siret
  if (s.adresse) form.adresse = s.adresse
  if (s.code_postal) form.code_postal = s.code_postal
  if (s.ville) form.ville = s.ville
  adresseCoords.value = null
  entrepriseOpen.value = false
  entrepriseSuggestions.value = []
}

interface AdresseSuggestion {
  label: string
  adresse: string
  code_postal: string
  ville: string
  lat: number
  lng: number
}
const adresseSuggestions = ref<AdresseSuggestion[]>([])
const adresseOpen = ref(false)
// Coordonnées issues d'une suggestion choisie : évite un géocodage au save.
const adresseCoords = ref<{ lat: number, lng: number } | null>(null)
let adresseTimer: ReturnType<typeof setTimeout> | null = null

function onAdresseInput() {
  adresseCoords.value = null
  if (adresseTimer) clearTimeout(adresseTimer)
  const q = form.adresse.trim()
  if (q.length < 3) {
    adresseSuggestions.value = []
    adresseOpen.value = false
    return
  }
  adresseTimer = setTimeout(async () => {
    try {
      adresseSuggestions.value = await $fetch('/api/adresse', { query: { q } })
      adresseOpen.value = adresseSuggestions.value.length > 0
    }
    catch {
      adresseSuggestions.value = []
      adresseOpen.value = false
    }
  }, 250)
}

function choisirAdresse(s: AdresseSuggestion) {
  form.adresse = s.adresse
  form.code_postal = s.code_postal
  form.ville = s.ville
  adresseCoords.value = { lat: s.lat, lng: s.lng }
  adresseOpen.value = false
  adresseSuggestions.value = []
}

async function rechercherSiret() {
  siretError.value = ''
  const siret = identite.siret.replace(/\s/g, '')
  if (!/^\d{14}$/.test(siret)) {
    siretError.value = 'Saisissez un SIRET de 14 chiffres.'
    return
  }
  siretLoading.value = true
  try {
    const data = await $fetch('/api/siret', { query: { siret } })
    if (data.raison_sociale) identite.raison_sociale = data.raison_sociale
    if (data.adresse) form.adresse = data.adresse
    if (data.code_postal) form.code_postal = data.code_postal
    if (data.ville) form.ville = data.ville
    adresseCoords.value = null
  }
  catch (e: unknown) {
    siretError.value = errorMessage(e, 'SIRET introuvable.')
  }
  finally {
    siretLoading.value = false
  }
}

async function save() {
  error.value = ''
  geocodeWarning.value = ''
  if (!identite.raison_sociale.trim()) {
    error.value = 'Saisissez une raison sociale.'
    return
  }
  if (form.debut_livraison && form.fin_livraison && form.fin_livraison < form.debut_livraison) {
    error.value = 'La fin de livraison doit suivre le début de livraison.'
    return
  }

  const scoring = form.scoring_entreprise === '' ? null : Number(form.scoring_entreprise)
  if (scoring !== null && (!Number.isFinite(scoring) || scoring < 0 || scoring > 10)) {
    error.value = 'La note de scoring entreprise doit être comprise entre 0 et 10.'
    return
  }

  saving.value = true
  // Géocodage automatique de l'adresse (ticket 05)
  const adresseComplete = [form.adresse, form.code_postal, form.ville].filter(Boolean).join(', ')
  const adresseChanged = !props.prospect
    || adresseComplete !== [props.prospect.adresse, props.prospect.code_postal, props.prospect.ville].filter(Boolean).join(', ')
  let lat = adresseChanged ? null : props.prospect?.lat ?? null
  let lng = adresseChanged ? null : props.prospect?.lng ?? null

  if (adresseCoords.value) {
    lat = adresseCoords.value.lat
    lng = adresseCoords.value.lng
  }
  else if (adresseComplete && adresseChanged) {
    try {
      const geo = await $fetch('/api/geocode', { method: 'POST', body: { adresse: adresseComplete } })
      lat = geo.lat
      lng = geo.lng
    }
    catch {
      geocodeWarning.value = 'Adresse non géocodée. Le calcul d\'itinéraire sera indisponible pour ce dossier.'
    }
  }

  const payload = {
    ...form,
    raison_sociale: identite.raison_sociale.trim(),
    siret: identite.siret.replace(/\s/g, '') || null,
    assigne_a: form.assigne_a || null,
    teleprospecteur_id: form.teleprospecteur_id || null,
    fournisseur: form.fournisseur || null,
    energie: form.energie || null,
    date_signature: form.date_signature || null,
    debut_livraison: form.debut_livraison || null,
    fin_livraison: form.fin_livraison || null,
    source: form.source.trim() || null,
    scoring_entreprise: scoring,
    lat,
    lng,
  }

  try {
    if (props.prospect) {
      const { data, error: err } = await supabase.from('prospects')
        .update(payload).eq('id', props.prospect.id).select('id').single()
      if (err) throw err
      emit('saved', data.id)
      return
    }

    const { data, error: err } = await supabase
      .from('prospects')
      .insert({
        ...payload,
        statut: statut.value,
        cree_par: userId.value,
      })
      .select('id')
      .single()
    if (err) throw err
    await supabase.from('prospect_activites').insert({
      prospect_id: data.id,
      auteur_id: userId.value,
      type: 'creation',
      detail: 'Dossier créé',
    })
    emit('saved', data.id)
  }
  catch (err) {
    error.value = errorMessage(err, 'Le dossier n’a pas pu être enregistré.')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="save">
    <div class="grid gap-4 md:grid-cols-2">
      <div class="relative">
        <label class="label">Raison sociale *</label>
        <input
          v-model="identite.raison_sociale" required class="input" autocomplete="off"
          @input="onRaisonSocialeInput" @focus="onRaisonSocialeInput"
          @blur="() => setTimeout(() => entrepriseOpen = false, 150)"
        >
        <ul v-if="entrepriseOpen" class="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
          <li
            v-for="s in entrepriseSuggestions" :key="s.siret || s.raison_sociale"
            class="cursor-pointer px-3 py-2 text-sm hover:bg-gray-100"
            @mousedown.prevent="choisirEntreprise(s)"
          >
            <span class="font-medium">{{ s.raison_sociale }}</span>
            <span v-if="s.code_postal || s.ville" class="block text-xs text-gray-500">{{ s.code_postal }} {{ s.ville }}</span>
          </li>
        </ul>
      </div>
      <div>
        <label class="label">SIRET</label>
        <div class="flex gap-2">
          <input v-model="identite.siret" class="input" pattern="[0-9]{14}" title="14 chiffres" placeholder="14 chiffres" @keydown.enter.prevent="rechercherSiret">
          <button type="button" class="btn-secondary whitespace-nowrap" :disabled="siretLoading" @click="rechercherSiret">
            {{ siretLoading ? 'Recherche…' : 'Rechercher' }}
          </button>
        </div>
        <p v-if="siretError" class="mt-1 text-sm text-red-600">{{ siretError }}</p>
      </div>
      <div>
        <label class="label">Contact</label>
        <input v-model="form.contact_nom" class="input">
      </div>
      <div>
        <label class="label">Téléphone</label>
        <input v-model="form.telephone" type="tel" class="input">
      </div>
      <div>
        <label class="label">Email</label>
        <input v-model="form.email" type="email" class="input">
      </div>
      <div>
        <label class="label">Téléprospecteur</label>
        <select v-model="form.teleprospecteur_id" class="input">
          <option value="">Non renseigné</option>
          <option v-for="t in teleprospecteurs" :key="t.id" :value="t.id">{{ displayName(t.nom) }}</option>
        </select>
      </div>
      <div>
        <label class="label">Fournisseur</label>
        <select v-model="form.fournisseur" class="input">
          <option value="">Non renseigné</option>
          <option v-for="(label, value) in FOURNISSEURS" :key="value" :value="value">{{ label }}</option>
        </select>
      </div>
      <label class="block">
        <span class="label">Énergie</span>
        <select v-model="form.energie" class="input">
          <option value="">Non renseignée</option>
          <option v-for="(label, value) in ENERGIES" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
      <label v-if="!prospect" class="block">
        <span class="label">Statut</span>
        <select v-model="statut" class="input">
          <option v-for="(label, value) in PROSPECT_STATUTS" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
      <label class="block">
        <span class="label">Source du dossier</span>
        <input v-model="form.source" class="input">
      </label>
      <label class="block">
        <span class="label">Scoring entreprise (note sur 10)</span>
        <input v-model.number="form.scoring_entreprise" type="number" min="0" max="10" step="any" class="input" placeholder="Ex. : 8">
      </label>
      <label class="block">
        <span class="label">Date de signature</span>
        <input v-model="form.date_signature" type="date" class="input">
        <span class="mt-1 block text-xs text-gray-500">Utilisée pour le suivi mensuel des dossiers signés.</span>
      </label>
      <label class="block">
        <span class="label">Début de livraison</span>
        <input v-model="form.debut_livraison" type="date" class="input">
      </label>
      <label class="block">
        <span class="label">Fin de livraison</span>
        <input v-model="form.fin_livraison" type="date" class="input" :min="form.debut_livraison || undefined">
      </label>
      <div class="md:col-span-2 relative">
        <label class="label">Adresse</label>
        <input
          v-model="form.adresse" class="input" autocomplete="off"
          @input="onAdresseInput" @focus="onAdresseInput"
          @blur="() => setTimeout(() => adresseOpen = false, 150)"
        >
        <ul v-if="adresseOpen" class="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
          <li
            v-for="s in adresseSuggestions" :key="s.label"
            class="cursor-pointer px-3 py-2 text-sm hover:bg-gray-100"
            @mousedown.prevent="choisirAdresse(s)"
          >
            {{ s.label }}
          </li>
        </ul>
      </div>
      <div>
        <label class="label">Code postal</label>
        <input v-model="form.code_postal" class="input" @input="adresseCoords = null">
      </div>
      <div>
        <label class="label">Ville</label>
        <input v-model="form.ville" class="input" @input="adresseCoords = null">
      </div>
      <div class="md:col-span-2">
        <label class="label">Commercial assigné</label>
        <select v-model="form.assigne_a" class="input">
          <option value="">Non assigné</option>
          <option v-for="c in commerciaux" :key="c.id" :value="c.id">{{ displayName(c.nom) }}</option>
        </select>
      </div>
      <div class="md:col-span-2">
        <label class="label">Notes</label>
        <textarea v-model="form.notes" rows="3" class="input" />
      </div>
    </div>
    <p v-if="geocodeWarning" class="text-sm text-amber-600">{{ geocodeWarning }}</p>
    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    <button type="submit" class="btn-primary" :disabled="saving">
      {{ saving ? 'Enregistrement…' : (prospect ? 'Enregistrer' : 'Créer le dossier') }}
    </button>
  </form>
</template>
