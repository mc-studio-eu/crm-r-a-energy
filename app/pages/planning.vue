<script setup lang="ts">
import { RDV_STATUTS } from '~~/shared/types'

const supabase = useSupabaseClient()

const semaine = ref(0) // décalage en semaines par rapport à aujourd'hui

const bornes = computed(() => {
  const lundi = new Date()
  lundi.setDate(lundi.getDate() - ((lundi.getDay() + 6) % 7) + semaine.value * 7)
  lundi.setHours(0, 0, 0, 0)
  const dimanche = new Date(lundi)
  dimanche.setDate(dimanche.getDate() + 7)
  return { debut: lundi.toISOString(), fin: dimanche.toISOString(), lundi }
})

const { data: rdvs } = await useAsyncData('planning', async () => {
  const { data } = await supabase
    .from('rdv')
    .select('*, prospects(id, raison_sociale, ville), profiles!rdv_commercial_id_fkey(id, nom)')
    .gte('debut', bornes.value.debut)
    .lt('debut', bornes.value.fin)
    .order('debut')
  return data ?? []
}, { watch: [semaine] })

type PlanningRdv = NonNullable<typeof rdvs.value>[number]

const parCommercial = computed(() => {
  const groups: Record<string, { nom: string, rdvs: PlanningRdv[] }> = {}
  for (const r of rdvs.value ?? []) {
    const id = r.profiles?.id ?? '?'
    groups[id] ??= { nom: displayName(r.profiles?.nom), rdvs: [] }
    groups[id].rdvs.push(r)
  }
  return groups
})

const fmt = (d: string) => new Date(d).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <div>
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl">Planning des commerciaux</h1>
      <div class="flex items-center gap-2 text-sm">
        <button class="btn-secondary !px-3 !py-1" @click="semaine--">←</button>
        <span class="font-medium">
          Semaine du {{ bornes.lundi.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) }}
        </span>
        <button class="btn-secondary !px-3 !py-1" @click="semaine++">→</button>
      </div>
    </div>

    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <div v-for="(c, id) in parCommercial" :key="id" class="card">
        <h2 class="mb-3 text-base">{{ c.nom }} <span class="text-sm font-normal text-gray-400">({{ c.rdvs.length }} RDV)</span></h2>
        <ul class="space-y-2 text-sm">
          <li v-for="r in c.rdvs" :key="r.id" class="rounded-lg border border-gray-100 p-2">
            <p class="font-medium">{{ fmt(r.debut) }}</p>
            <p class="text-xs text-gray-500">
              <NuxtLink :to="`/prospects/${r.prospects?.id}`" class="text-primary hover:underline">
                {{ r.prospects?.raison_sociale }}
              </NuxtLink>
              · {{ r.prospects?.ville }} · {{ RDV_STATUTS[r.statut] }}
            </p>
          </li>
        </ul>
      </div>
      <p v-if="!Object.keys(parCommercial).length" class="col-span-full py-16 text-center text-gray-400">
        Aucun RDV cette semaine.
      </p>
    </div>
  </div>
</template>
