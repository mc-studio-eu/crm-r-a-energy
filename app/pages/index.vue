<script setup lang="ts">
import { PROSPECT_STATUTS, type ProspectStatut } from '~~/shared/types'

const supabase = useSupabaseClient()
const { profile } = useProfile()

const { data: stats } = await useAsyncData('dashboard-stats', async () => {
  const counts: Partial<Record<ProspectStatut, number>> = {}
  for (const statut of Object.keys(PROSPECT_STATUTS) as ProspectStatut[]) {
    const { count } = await supabase
      .from('prospects')
      .select('id', { count: 'exact', head: true })
      .eq('statut', statut)
      .eq('archive', false)
    counts[statut] = count ?? 0
  }
  const today = new Date().toISOString().slice(0, 10)
  const { count: rdvAujourdhui } = await supabase
    .from('rdv')
    .select('id', { count: 'exact', head: true })
    .eq('statut', 'planifie')
    .gte('debut', `${today}T00:00:00Z`)
    .lte('debut', `${today}T23:59:59Z`)
  return { counts, rdvAujourdhui: rdvAujourdhui ?? 0 }
})
</script>

<template>
  <div>
    <h1 class="mb-1 text-2xl">Tableau de bord</h1>
    <p class="mb-6 text-sm text-gray-500">Bonjour {{ profile?.nom }} 👋</p>

    <div class="grid grid-cols-2 gap-4 lg:grid-cols-6">
      <div v-for="(label, statut) in PROSPECT_STATUTS" :key="statut" class="card">
        <p class="text-2xl font-bold text-primary">{{ stats?.counts[statut] ?? 0 }}</p>
        <p class="text-sm text-gray-500">{{ label }}</p>
      </div>
      <div class="card bg-primary text-white">
        <p class="text-2xl font-bold">{{ stats?.rdvAujourdhui ?? 0 }}</p>
        <p class="text-sm text-white/80">RDV aujourd'hui</p>
      </div>
    </div>

    <div class="mt-8 flex gap-3">
      <NuxtLink to="/prospects/new" class="btn-primary">+ Nouveau prospect</NuxtLink>
      <NuxtLink to="/prospects" class="btn-secondary">Voir les prospects</NuxtLink>
    </div>
  </div>
</template>
