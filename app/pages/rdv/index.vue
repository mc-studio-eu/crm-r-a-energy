<script setup lang="ts">
import { RDV_STATUTS, type RdvStatut } from '~~/shared/types'

const supabase = useSupabaseClient()
const user = useSupabaseUser()

const { data: rdvs, refresh } = await useAsyncData('mes-rdv', async () => {
  const { data } = await supabase
    .from('rdv')
    .select('*, prospects(id, raison_sociale, telephone)')
    .eq('commercial_id', user.value!.id)
    .gte('debut', new Date(Date.now() - 7 * 86400_000).toISOString())
    .order('debut')
  return data ?? []
})

async function setStatut(id: string, statut: RdvStatut) {
  await $fetch(`/api/rdv/${id}`, { method: 'PATCH', body: { statut } })
  refresh()
}

type MonRdv = NonNullable<typeof rdvs.value>[number]

const parJour = computed(() => {
  const groups: Record<string, MonRdv[]> = {}
  for (const r of rdvs.value ?? []) {
    const jour = new Date(r.debut).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    ;(groups[jour] ??= []).push(r)
  }
  return groups
})

const heure = (d: string) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <div class="max-w-3xl">
    <h1 class="mb-6 text-2xl">Mes RDV</h1>
    <div v-for="(items, jour) in parJour" :key="jour" class="mb-6">
      <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{{ jour }}</h2>
      <div class="space-y-2">
        <div v-for="r in items" :key="r.id" class="card flex items-center justify-between !p-4">
          <div>
            <p class="font-medium">
              {{ heure(r.debut) }} – {{ heure(r.fin) }} ·
              <NuxtLink :to="`/prospects/${r.prospects?.id}`" class="text-primary hover:underline">
                {{ r.prospects?.raison_sociale }}
              </NuxtLink>
            </p>
            <p class="text-xs text-gray-500">
              {{ r.lieu }}
              <span v-if="r.temps_trajet_min"> · 🚗 {{ r.temps_trajet_min }} min</span>
              · <a :href="`tel:${r.prospects?.telephone}`" class="text-primary">{{ r.prospects?.telephone }}</a>
            </p>
          </div>
          <select
            class="rounded border border-gray-200 px-2 py-1 text-xs"
            :value="r.statut"
            @change="setStatut(r.id, ($event.target as HTMLSelectElement).value as RdvStatut)"
          >
            <option v-for="(label, s) in RDV_STATUTS" :key="s" :value="s">{{ label }}</option>
          </select>
        </div>
      </div>
    </div>
    <p v-if="!rdvs?.length" class="py-16 text-center text-gray-400">Aucun RDV à venir.</p>
  </div>
</template>
