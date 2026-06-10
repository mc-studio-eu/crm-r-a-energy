<script setup lang="ts">
import {
  PROSPECT_STATUTS,
  PROSPECT_STATUT_COLORS,
  RDV_STATUTS,
  type ProspectStatut,
  type RdvStatut,
} from '~~/shared/types'

const supabase = useSupabaseClient()
const { profile } = useProfile()

const { data: stats } = await useAsyncData('dashboard-stats', async () => {
  // Compteurs par statut
  const counts: Record<ProspectStatut, number> = {
    nouveau: 0, a_rappeler: 0, rdv_place: 0, signe: 0, perdu: 0,
  }
  for (const statut of Object.keys(PROSPECT_STATUTS) as ProspectStatut[]) {
    const { count } = await supabase
      .from('prospects')
      .select('id', { count: 'exact', head: true })
      .eq('statut', statut)
      .eq('archive', false)
    counts[statut] = count ?? 0
  }
  const totalProspects = Object.values(counts).reduce((s, c) => s + c, 0)

  // RDV : aujourd'hui + 7 prochains jours, et répartition par statut
  const today = new Date().toISOString().slice(0, 10)
  const dans7j = new Date(Date.now() + 7 * 86400_000).toISOString()
  const { count: rdvAujourdhui } = await supabase
    .from('rdv').select('id', { count: 'exact', head: true })
    .eq('statut', 'planifie')
    .gte('debut', `${today}T00:00:00Z`).lte('debut', `${today}T23:59:59Z`)
  const { count: rdv7j } = await supabase
    .from('rdv').select('id', { count: 'exact', head: true })
    .eq('statut', 'planifie')
    .gte('debut', new Date().toISOString()).lte('debut', dans7j)

  const rdvParStatut: Record<RdvStatut, number> = { planifie: 0, honore: 0, annule: 0, no_show: 0 }
  for (const s of Object.keys(RDV_STATUTS) as RdvStatut[]) {
    const { count } = await supabase
      .from('rdv').select('id', { count: 'exact', head: true }).eq('statut', s)
    rdvParStatut[s] = count ?? 0
  }

  // Tendance : prospects créés sur les 8 dernières semaines
  const depuis = new Date(Date.now() - 8 * 7 * 86400_000)
  depuis.setHours(0, 0, 0, 0)
  const { data: recents } = await supabase
    .from('prospects')
    .select('created_at')
    .gte('created_at', depuis.toISOString())

  const buckets: { label: string, value: number, start: number }[] = []
  for (let i = 7; i >= 0; i--) {
    const d = new Date(Date.now() - i * 7 * 86400_000)
    d.setHours(0, 0, 0, 0)
    // ramener au lundi de la semaine
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    const start = d.getTime()
    if (!buckets.some(b => b.start === start)) {
      buckets.push({
        label: d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
        value: 0,
        start,
      })
    }
  }
  for (const r of recents ?? []) {
    const t = new Date(r.created_at).getTime()
    let target = buckets[0]
    for (const b of buckets) if (t >= b.start) target = b
    if (target) target.value++
  }

  // Taux de conversion (signé / total non archivé)
  const conversion = totalProspects ? Math.round((counts.signe / totalProspects) * 100) : 0

  return {
    counts, totalProspects, rdvAujourdhui: rdvAujourdhui ?? 0, rdv7j: rdv7j ?? 0,
    rdvParStatut, trend: buckets, conversion,
  }
})

const donutSegments = computed(() =>
  (Object.keys(PROSPECT_STATUTS) as ProspectStatut[]).map(s => ({
    label: PROSPECT_STATUTS[s],
    value: stats.value?.counts[s] ?? 0,
    color: PROSPECT_STATUT_COLORS[s],
  })))

// Entonnoir de conversion (pipeline ordonné)
const funnelBars = computed(() => {
  const order: ProspectStatut[] = ['nouveau', 'a_rappeler', 'rdv_place', 'signe']
  return order.map(s => ({
    label: PROSPECT_STATUTS[s],
    value: stats.value?.counts[s] ?? 0,
    color: PROSPECT_STATUT_COLORS[s],
  }))
})

const rdvBars = computed(() => {
  const colors: Record<RdvStatut, string> = {
    planifie: '#31694E', honore: '#16A34A', annule: '#9CA3AF', no_show: '#DC2626',
  }
  return (Object.keys(RDV_STATUTS) as RdvStatut[]).map(s => ({
    label: RDV_STATUTS[s],
    value: stats.value?.rdvParStatut[s] ?? 0,
    color: colors[s],
  }))
})

const kpis = computed(() => [
  { label: 'Prospects actifs', value: stats.value?.totalProspects ?? 0, sub: 'non archivés' },
  { label: 'RDV aujourd\'hui', value: stats.value?.rdvAujourdhui ?? 0, sub: 'planifiés', highlight: true },
  { label: 'RDV à venir (7 j)', value: stats.value?.rdv7j ?? 0, sub: 'cette semaine' },
  { label: 'Taux de signature', value: `${stats.value?.conversion ?? 0}%`, sub: 'signés / total' },
])
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="mb-1 text-2xl">Tableau de bord</h1>
        <p class="text-sm text-gray-500">Bonjour {{ displayName(profile?.nom) }} 👋</p>
      </div>
      <div class="flex gap-3">
        <NuxtLink to="/prospects" class="btn-secondary">Voir les prospects</NuxtLink>
        <NuxtLink to="/prospects/new" class="btn-primary">+ Nouveau prospect</NuxtLink>
      </div>
    </div>

    <!-- KPIs -->
    <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <div
        v-for="k in kpis" :key="k.label" class="card"
        :class="k.highlight ? 'bg-primary text-white' : ''"
      >
        <p class="text-3xl font-bold" :class="k.highlight ? '' : 'text-primary'" style="font-family: Manrope, sans-serif">
          {{ k.value }}
        </p>
        <p class="mt-1 text-sm font-medium" :class="k.highlight ? 'text-white' : ''">{{ k.label }}</p>
        <p class="text-xs" :class="k.highlight ? 'text-white/70' : 'text-gray-400'">{{ k.sub }}</p>
      </div>
    </div>

    <!-- Graphiques -->
    <div class="mt-6 grid gap-4 lg:grid-cols-2">
      <div class="card">
        <h2 class="mb-4 text-base">Répartition du pipeline</h2>
        <DonutChart :segments="donutSegments" />
      </div>

      <div class="card">
        <h2 class="mb-4 text-base">Entonnoir de conversion</h2>
        <BarChart :bars="funnelBars" />
      </div>

      <div class="card lg:col-span-2">
        <h2 class="mb-1 text-base">Prospects créés</h2>
        <p class="mb-2 text-xs text-gray-400">8 dernières semaines</p>
        <TrendChart v-if="stats?.trend" :points="stats.trend" />
      </div>

      <div class="card lg:col-span-2">
        <h2 class="mb-4 text-base">Rendez-vous par statut</h2>
        <BarChart :bars="rdvBars" />
      </div>
    </div>
  </div>
</template>
