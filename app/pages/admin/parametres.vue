<script setup lang="ts">
const supabase = useSupabaseClient()

const marge = ref<number>(15)
const saved = ref(false)

const { data } = await useAsyncData('settings', async () => {
  const { data } = await supabase.from('app_settings').select('key, value')
  return data ?? []
})
watchEffect(() => {
  const m = data.value?.find(s => s.key === 'marge_trajet_min')
  if (m) marge.value = Number(m.value)
})

async function save() {
  await supabase
    .from('app_settings')
    .update({ value: marge.value })
    .eq('key', 'marge_trajet_min')
  saved.value = true
  setTimeout(() => saved.value = false, 2000)
}
</script>

<template>
  <div class="max-w-xl">
    <h1 class="mb-6 text-2xl">Paramètres</h1>
    <div class="card">
      <h2 class="mb-3 text-base">Règle d'itinéraire</h2>
      <p class="mb-3 text-sm text-gray-500">
        Marge de sécurité ajoutée au temps de trajet lors de la vérification d'un créneau de RDV.
      </p>
      <form class="flex items-end gap-3" @submit.prevent="save">
        <div>
          <label class="label">Marge (minutes)</label>
          <input v-model.number="marge" type="number" min="0" max="120" class="input !w-28">
        </div>
        <button type="submit" class="btn-primary">Enregistrer</button>
        <span v-if="saved" class="text-sm text-green-700">✓ Enregistré</span>
      </form>
    </div>
  </div>
</template>
