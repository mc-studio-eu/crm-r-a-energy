<script setup lang="ts">
import type { Prospect, RdvCheckResult } from '~~/shared/types'

const props = defineProps<{ prospect: Prospect }>()
const emit = defineEmits<{ created: [] }>()

const supabase = useSupabaseClient()

const { data: commerciaux } = await useAsyncData('rdv-commerciaux', async () => {
  const { data } = await supabase
    .from('profiles')
    .select('id, nom, google_calendar_connected')
    .eq('role', 'commercial')
    .eq('actif', true)
    .order('nom')
  return data ?? []
})

const form = reactive({
  commercial_id: props.prospect.assigne_a ?? '',
  date: '',
  heure: '10:00',
  duree: 60,
  lieu: [props.prospect.adresse, props.prospect.code_postal, props.prospect.ville].filter(Boolean).join(', '),
  notes: '',
})

const checking = ref(false)
const saving = ref(false)
const checkResult = ref<RdvCheckResult | null>(null)
const error = ref('')

const debutISO = computed(() => {
  if (!form.date || !form.heure) return null
  return new Date(`${form.date}T${form.heure}:00`).toISOString()
})
const finISO = computed(() => {
  if (!debutISO.value) return null
  return new Date(new Date(debutISO.value).getTime() + form.duree * 60_000).toISOString()
})

const canCheck = computed(() =>
  form.commercial_id && debutISO.value && props.prospect.lat != null && props.prospect.lng != null)

/** Check dispo + itinéraire en direct à la sélection du créneau (tickets 07 + 08). */
async function runCheck() {
  if (!canCheck.value) return
  checking.value = true
  checkResult.value = null
  error.value = ''
  try {
    checkResult.value = await $fetch<RdvCheckResult>('/api/rdv/check', {
      method: 'POST',
      body: {
        commercial_id: form.commercial_id,
        debut: debutISO.value,
        fin: finISO.value,
        lieu_lat: props.prospect.lat,
        lieu_lng: props.prospect.lng,
      },
    })
  }
  catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Erreur lors de la vérification'
  }
  checking.value = false
}

watch([() => form.commercial_id, debutISO, () => form.duree], () => {
  checkResult.value = null
  if (canCheck.value) runCheck()
})

async function save() {
  if (!checkResult.value?.ok) return
  saving.value = true
  error.value = ''
  try {
    await $fetch('/api/rdv', {
      method: 'POST',
      body: {
        prospect_id: props.prospect.id,
        commercial_id: form.commercial_id,
        debut: debutISO.value,
        fin: finISO.value,
        lieu: form.lieu,
        lieu_lat: props.prospect.lat,
        lieu_lng: props.prospect.lng,
        notes: form.notes || undefined,
      },
    })
    // Le RDV placé fait avancer le pipeline
    await supabase.from('prospects').update({ statut: 'rdv_place' }).eq('id', props.prospect.id)
    emit('created')
  }
  catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Erreur lors de la création du RDV'
    if (e?.data?.data) checkResult.value = e.data.data
  }
  saving.value = false
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="save">
    <div v-if="prospect.lat == null" class="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
      ⚠️ Adresse du prospect non géocodée : les checks d'itinéraire sont indisponibles.
      Modifiez la fiche pour corriger l'adresse.
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <div class="md:col-span-2">
        <label class="label">Commercial assigné *</label>
        <select v-model="form.commercial_id" required class="input">
          <option value="" disabled>Choisir…</option>
          <option v-for="c in commerciaux" :key="c.id" :value="c.id">
            {{ c.nom }}{{ c.google_calendar_connected ? '' : ' (agenda non connecté)' }}
          </option>
        </select>
      </div>
      <div>
        <label class="label">Date *</label>
        <input v-model="form.date" type="date" required class="input">
      </div>
      <div>
        <label class="label">Heure *</label>
        <input v-model="form.heure" type="time" required class="input">
      </div>
      <div>
        <label class="label">Durée (min)</label>
        <select v-model.number="form.duree" class="input">
          <option :value="30">30 min</option>
          <option :value="60">1 h</option>
          <option :value="90">1 h 30</option>
          <option :value="120">2 h</option>
        </select>
      </div>
      <div>
        <label class="label">Lieu</label>
        <input v-model="form.lieu" class="input">
      </div>
      <div class="md:col-span-2">
        <label class="label">Notes</label>
        <textarea v-model="form.notes" rows="2" class="input" />
      </div>
    </div>

    <!-- Résultat des checks -->
    <div v-if="checking" class="text-sm text-gray-500">Vérification dispo + itinéraire…</div>
    <div v-else-if="checkResult" class="space-y-2 text-sm">
      <p :class="checkResult.disponibilite.ok ? 'text-green-700' : 'text-red-600'">
        {{ checkResult.disponibilite.ok
          ? '✓ Créneau libre dans l\'agenda'
          : `✗ Conflit d'agenda : occupé de ${new Date(checkResult.disponibilite.conflit!.debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} à ${new Date(checkResult.disponibilite.conflit!.fin).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` }}
      </p>
      <p :class="checkResult.trajet.ok ? 'text-green-700' : 'text-red-600'">
        <template v-if="checkResult.trajet.tempsTrajetMin != null">
          {{ checkResult.trajet.ok ? '✓' : '✗' }}
          Trajet estimé : {{ checkResult.trajet.tempsTrajetMin }} min
          (marge {{ checkResult.trajet.margeMin }} min)
          <span v-if="checkResult.trajet.motif"> — {{ checkResult.trajet.motif }}</span>
        </template>
        <template v-else>⚠️ {{ checkResult.trajet.motif }}</template>
      </p>
    </div>
    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

    <button type="submit" class="btn-primary" :disabled="saving || !checkResult?.ok">
      {{ saving ? 'Création…' : 'Valider le RDV' }}
    </button>
  </form>
</template>
