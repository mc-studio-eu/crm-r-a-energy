<script setup lang="ts">
const props = defineProps<{ rdv: { id: string, debut: string, fin: string, qualification?: string | null, statut: string } }>()
const emit = defineEmits<{ saved: [] }>()
const open = ref(false)
const saving = ref(false)
const error = ref('')
const date = ref('')
const duration = ref(60)
const qualification = ref('')
function edit() {
  const d = new Date(props.rdv.debut)
  date.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  duration.value = (new Date(props.rdv.fin).getTime() - d.getTime()) / 60000
  qualification.value = props.rdv.qualification ?? ''
  error.value = ''
  open.value = true
}
async function save() {
  saving.value = true
  error.value = ''
  try {
    const debut = new Date(date.value).toISOString()
    const fin = new Date(new Date(debut).getTime() + duration.value * 60000).toISOString()
    await $fetch(`/api/rdv/${props.rdv.id}`, { method: 'PATCH', body: { debut, fin, qualification: qualification.value || null } })
    open.value = false
    emit('saved')
  }
  catch (e) { error.value = errorMessage(e, 'Modification impossible') }
  finally { saving.value = false }
}
</script>

<template>
  <div v-if="rdv.statut === 'planifie'" class="mt-2 text-xs">
    <button v-if="!open" class="text-primary underline" type="button" @click.prevent="edit">Modifier le rendez-vous</button>
    <form v-else class="space-y-2 rounded border bg-white p-3" @submit.prevent="save">
      <label class="block">Date et heure <input v-model="date" type="datetime-local" required class="input"></label>
      <label class="block">Durée en minutes <input v-model.number="duration" type="number" min="1" max="1440" required class="input"></label>
      <label class="block">Étape <select v-model="qualification" class="input"><option value="">Non renseignée</option><option>R1</option><option>R2</option></select></label>
      <p v-if="error" class="text-red-600">{{ error }}</p>
      <div class="flex gap-2"><button class="btn-primary" :disabled="saving">{{ saving ? 'Vérification…' : 'Enregistrer' }}</button><button type="button" class="btn-secondary" @click="open = false">Annuler</button></div>
    </form>
  </div>
</template>
