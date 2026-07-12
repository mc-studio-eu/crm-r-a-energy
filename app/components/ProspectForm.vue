<script setup lang="ts">
import type { Prospect } from '~~/shared/types'

const props = defineProps<{ prospect?: Prospect | null }>()
const emit = defineEmits<{ saved: [id: string] }>()

const supabase = useSupabaseClient()
const userId = useUserId()

const form = reactive({
  raison_sociale: props.prospect?.raison_sociale ?? '',
  siret: props.prospect?.siret ?? '',
  contact_nom: props.prospect?.contact_nom ?? '',
  telephone: props.prospect?.telephone ?? '',
  email: props.prospect?.email ?? '',
  adresse: props.prospect?.adresse ?? '',
  code_postal: props.prospect?.code_postal ?? '',
  ville: props.prospect?.ville ?? '',
  source: props.prospect?.source ?? '',
  notes: props.prospect?.notes ?? '',
  assigne_a: props.prospect?.assigne_a ?? '',
})

const { data: commerciaux } = await useAsyncData('form-commerciaux', async () => {
  const { data } = await supabase
    .from('profiles').select('id, nom').eq('role', 'commercial').eq('actif', true).order('nom')
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
  const q = form.raison_sociale.trim()
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
  form.raison_sociale = s.raison_sociale
  if (s.siret) form.siret = s.siret
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
  const siret = form.siret.replace(/\s/g, '')
  if (!/^\d{14}$/.test(siret)) {
    siretError.value = 'Saisissez un SIRET de 14 chiffres.'
    return
  }
  siretLoading.value = true
  try {
    const data = await $fetch('/api/siret', { query: { siret } })
    if (data.raison_sociale) form.raison_sociale = data.raison_sociale
    if (data.adresse) form.adresse = data.adresse
    if (data.code_postal) form.code_postal = data.code_postal
    if (data.ville) form.ville = data.ville
  }
  catch (e: unknown) {
    siretError.value = errorMessage(e, 'SIRET introuvable.')
  }
  finally {
    siretLoading.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  geocodeWarning.value = ''

  // Géocodage automatique de l'adresse (ticket 05)
  let lat: number | null = props.prospect?.lat ?? null
  let lng: number | null = props.prospect?.lng ?? null
  const adresseComplete = [form.adresse, form.code_postal, form.ville].filter(Boolean).join(', ')
  const adresseChanged = !props.prospect
    || adresseComplete !== [props.prospect.adresse, props.prospect.code_postal, props.prospect.ville].filter(Boolean).join(', ')

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
      geocodeWarning.value = 'Adresse non géocodée — le calcul d\'itinéraire sera indisponible pour ce prospect.'
    }
  }

  const payload = {
    ...form,
    assigne_a: form.assigne_a || null,
    lat,
    lng,
  }

  if (props.prospect) {
    const { error: err } = await supabase.from('prospects').update(payload).eq('id', props.prospect.id)
    if (err) { error.value = err.message; saving.value = false; return }
    emit('saved', props.prospect.id)
  }
  else {
    const { data, error: err } = await supabase
      .from('prospects')
      .insert({ ...payload, cree_par: userId.value })
      .select('id')
      .single()
    if (err || !data) { error.value = err?.message ?? 'Erreur'; saving.value = false; return }
    await supabase.from('prospect_activites').insert({
      prospect_id: data.id,
      auteur_id: userId.value,
      type: 'creation',
      detail: 'Fiche créée',
    })
    emit('saved', data.id)
  }
  saving.value = false
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="save">
    <div class="grid gap-4 md:grid-cols-2">
      <div class="relative">
        <label class="label">Raison sociale *</label>
        <input
          v-model="form.raison_sociale" required class="input" autocomplete="off"
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
          <input v-model="form.siret" class="input" pattern="[0-9]{14}" title="14 chiffres" placeholder="14 chiffres" @keydown.enter.prevent="rechercherSiret">
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
        <label class="label">Source</label>
        <input v-model="form.source" class="input" placeholder="Téléprospection, salon…">
      </div>
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
        <input v-model="form.code_postal" class="input">
      </div>
      <div>
        <label class="label">Ville</label>
        <input v-model="form.ville" class="input">
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
      {{ saving ? 'Enregistrement…' : (prospect ? 'Enregistrer' : 'Créer la fiche') }}
    </button>
  </form>
</template>
