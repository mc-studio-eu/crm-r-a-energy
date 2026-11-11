<script setup lang="ts">
const props = defineProps<{ rdv: { id: string, google_sync_status?: string, google_sync_error?: string | null } }>()
const emit = defineEmits<{ refreshed: [] }>()
const loading = ref(false)
const error = ref('')
const labels: Record<string, string> = { synced: 'Agenda synchronisé', pending: 'Synchronisation en attente', error: 'Échec de synchronisation', disconnected: 'Agenda non connecté' }
async function retry() {
  loading.value = true
  error.value = ''
  try {
    const result = await $fetch(`/api/rdv/${props.rdv.id}/sync`, { method: 'POST' })
    if (result.status === 'error') error.value = 'Vérifiez la connexion Google dans votre profil.'
    emit('refreshed')
  }
  catch (e) { error.value = errorMessage(e, 'Synchronisation impossible') }
  finally { loading.value = false }
}
</script>

<template>
  <div class="mt-1 text-xs text-gray-500">
    <span>{{ labels[rdv.google_sync_status ?? 'pending'] }}</span>
    <button v-if="rdv.google_sync_status !== 'synced'" type="button" class="ml-2 text-primary underline" :disabled="loading" @click.prevent="retry">{{ loading ? 'Synchronisation…' : 'Réessayer' }}</button>
    <p v-if="error" class="text-red-600">{{ error }}</p>
  </div>
</template>
