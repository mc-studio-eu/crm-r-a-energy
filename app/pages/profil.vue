<script setup lang="ts">
const supabase = useSupabaseClient()
const route = useRoute()
const { profile, load } = useProfile()
await load()

const form = reactive({
  nom: profile.value?.nom ?? '',
  telephone: profile.value?.telephone ?? '',
  adresse_depart: profile.value?.adresse_depart ?? '',
})

const saving = ref(false)
const message = ref('')

const calendarStatus = computed(() => route.query.calendar as string | undefined)

async function save() {
  saving.value = true
  message.value = ''

  let depart_lat = profile.value?.depart_lat ?? null
  let depart_lng = profile.value?.depart_lng ?? null

  // Géocodage de l'adresse de base (utilisée par le calcul d'itinéraire)
  if (form.adresse_depart && form.adresse_depart !== profile.value?.adresse_depart) {
    try {
      const geo = await $fetch('/api/geocode', { method: 'POST', body: { adresse: form.adresse_depart } })
      depart_lat = geo.lat
      depart_lng = geo.lng
    }
    catch {
      message.value = '⚠️ Adresse de départ non géocodée'
    }
  }

  await supabase
    .from('profiles')
    .update({ ...form, depart_lat, depart_lng })
    .eq('id', profile.value!.id)

  profile.value = null
  await load()
  message.value ||= '✓ Profil enregistré'
  saving.value = false
}

async function disconnectCalendar() {
  await $fetch('/api/google/oauth/disconnect', { method: 'POST' })
  profile.value = null
  await load()
}
</script>

<template>
  <div class="max-w-xl">
    <h1 class="mb-6 text-2xl">Mon profil</h1>

    <div class="card mb-6">
      <form class="space-y-4" @submit.prevent="save">
        <div>
          <label class="label">Nom</label>
          <input v-model="form.nom" required class="input">
        </div>
        <div>
          <label class="label">Téléphone</label>
          <input v-model="form.telephone" type="tel" class="input">
        </div>
        <div>
          <label class="label">Adresse de départ (calcul d'itinéraire)</label>
          <input v-model="form.adresse_depart" class="input" placeholder="Ex : 16 rue Cuvier, 69006 Lyon">
        </div>
        <p v-if="message" class="text-sm" :class="message.startsWith('✓') ? 'text-green-700' : 'text-amber-600'">{{ message }}</p>
        <button type="submit" class="btn-primary" :disabled="saving">Enregistrer</button>
      </form>
    </div>

    <!-- Google Calendar (ticket 07) -->
    <div class="card">
      <h2 class="mb-2 text-base">Google Agenda</h2>
      <p v-if="calendarStatus === 'connected'" class="mb-2 text-sm text-green-700">✓ Agenda connecté avec succès.</p>
      <p v-if="calendarStatus === 'error'" class="mb-2 text-sm text-red-600">La connexion de l'agenda a échoué, réessayez.</p>

      <template v-if="profile?.google_calendar_connected">
        <p class="mb-3 text-sm text-green-700">✓ Votre agenda Google est connecté : vos disponibilités sont vérifiées automatiquement et les RDV sont ajoutés à votre agenda.</p>
        <button class="btn-secondary" @click="disconnectCalendar">Déconnecter</button>
      </template>
      <template v-else>
        <p class="mb-3 text-sm text-gray-500">Connectez votre agenda pour la vérification de disponibilité en temps réel et la création automatique des événements RDV.</p>
        <a href="/api/google/oauth/connect" class="btn-primary">Connecter mon Google Agenda</a>
      </template>
    </div>
  </div>
</template>
