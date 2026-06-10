<script setup lang="ts">
import type { Prospect } from '~~/shared/types'

const props = defineProps<{ prospect?: Prospect | null }>()
const emit = defineEmits<{ saved: [id: string] }>()

const supabase = useSupabaseClient()
const user = useSupabaseUser()

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

  if (adresseComplete && adresseChanged) {
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
      .insert({ ...payload, cree_par: user.value?.id })
      .select('id')
      .single()
    if (err || !data) { error.value = err?.message ?? 'Erreur'; saving.value = false; return }
    await supabase.from('prospect_activites').insert({
      prospect_id: data.id,
      auteur_id: user.value?.id,
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
      <div>
        <label class="label">Raison sociale *</label>
        <input v-model="form.raison_sociale" required class="input">
      </div>
      <div>
        <label class="label">SIRET</label>
        <input v-model="form.siret" class="input" pattern="[0-9]{14}" title="14 chiffres">
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
      <div class="md:col-span-2">
        <label class="label">Adresse</label>
        <input v-model="form.adresse" class="input">
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
