<script setup lang="ts">
import {
  PROSPECT_STATUTS,
  PROSPECT_STATUT_COLORS,
  RDV_STATUTS,
  type ProspectStatut,
  type RdvStatut,
} from '~~/shared/types'

const user = useSupabaseUser()
const supabase = useSupabaseClient()
const { profile } = useProfile()

useHead({
  title: () => user.value ? 'Tableau de bord — R&A Energy' : 'R&A Energy — CRM Professionnel & Planification',
  meta: [
    {
      name: 'description',
      content: () => user.value
        ? 'Accédez à votre tableau de bord CRM R&A Energy.'
        : 'Plateforme interne de R&A Energy : gestion intelligente de prospects, intégration Google Calendar et calcul d\'itinéraires.'
    }
  ]
})

const { data: stats } = await useAsyncData('dashboard-stats', async () => {
  if (!user.value) return null

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
}, {
  watch: [user],
  immediate: !!user.value
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
  <div v-if="user">
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

  <!-- Page d'accueil publique de présentation -->
  <div v-else class="flex min-h-screen flex-col bg-app-bg">
    <!-- Barre de Navigation Simple -->
    <header class="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
      <div class="flex items-center gap-2">
        <span class="text-xl font-extrabold text-primary tracking-tight font-manrope">R&A Energy</span>
        <span class="rounded bg-secondary/30 px-2 py-0.5 text-[10px] font-semibold text-primary">CRM</span>
      </div>
      <NuxtLink to="/login" class="btn-primary">
        Se connecter
      </NuxtLink>
    </header>

    <!-- Section Hero -->
    <main class="mx-auto flex-1 w-full max-w-6xl px-6 py-12 md:py-24">
      <div class="grid gap-12 lg:grid-cols-12 lg:items-center">
        <!-- Contenu Hero -->
        <div class="lg:col-span-7 space-y-6">
          <div class="inline-flex items-center gap-2 rounded-full bg-secondary-light px-3 py-1 text-xs font-semibold text-primary">
            ✨ Solution Interne R&A Energy
          </div>
          <h1 class="text-4xl font-extrabold tracking-tight text-ink md:text-5xl lg:text-6xl font-manrope leading-tight">
            Planification & Gestion intelligente de prospects
          </h1>
          <p class="text-base md:text-lg text-gray-600 max-w-xl leading-relaxed">
            Notre plateforme CRM permet de centraliser les dossiers clients, de coordonner les agendas de nos commerciaux grâce à la synchronisation Google Calendar en temps réel, et d'optimiser les trajets de prospection.
          </p>
          <div class="flex flex-wrap gap-4 pt-2">
            <NuxtLink to="/login" class="btn-primary text-base px-6 py-3 shadow-md shadow-primary/20 hover:scale-[1.02] transition-transform">
              Accéder à mon espace
            </NuxtLink>
            <a href="#features" class="btn-secondary text-base px-6 py-3 hover:scale-[1.02] transition-transform">
              Découvrir les fonctionnalités
            </a>
          </div>
        </div>

        <!-- Illustration Visuelle Premium -->
        <div class="lg:col-span-5 relative flex justify-center">
          <div class="relative w-full max-w-sm rounded-2xl bg-gradient-to-tr from-primary to-secondary/40 p-1 shadow-2xl">
            <div class="rounded-xl bg-white p-6 space-y-4">
              <div class="flex items-center justify-between border-b border-gray-100 pb-3">
                <span class="text-sm font-bold text-gray-800">Prochain RDV commercial</span>
                <span class="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">Validé</span>
              </div>
              <div class="space-y-2">
                <p class="text-xs text-gray-400">Prospect</p>
                <p class="text-sm font-semibold text-ink">M. Jean Dupont</p>
              </div>
              <div class="flex items-center gap-3 rounded-lg bg-gray-50 p-3 border border-gray-100">
                <svg class="h-5 w-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <div>
                  <p class="text-xs text-gray-500">Google Calendar Synchro</p>
                  <p class="text-xs font-medium text-gray-800">Lundi 29 juin — 14h00</p>
                </div>
              </div>
              <div class="flex items-center gap-3 rounded-lg bg-gray-50 p-3 border border-gray-100">
                <svg class="h-5 w-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A2 2 0 013 15.485V5.515a2 2 0 011.553-1.943L9 2.06l5.447 2.724A2 2 0 0115 6.728v9.957a2 2 0 01-1.553 1.943L9 20z" />
                </svg>
                <div>
                  <p class="text-xs text-gray-500">Calcul Itinéraire (Google Routes)</p>
                  <p class="text-xs font-medium text-gray-800">Temps de trajet estimé : 24 min</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Section Features -->
      <section id="features" class="mt-24 md:mt-32 space-y-12 border-t border-gray-200/60 pt-20">
        <div class="text-center max-w-2xl mx-auto space-y-3">
          <h2 class="text-3xl font-extrabold text-ink tracking-tight font-manrope">
            Fonctionnalités Clés du CRM
          </h2>
          <p class="text-gray-500 text-sm md:text-base">
            Développé spécifiquement pour répondre aux besoins opérationnels de R&A Energy.
          </p>
        </div>

        <div class="grid gap-8 md:grid-cols-3">
          <!-- Card 1 -->
          <div class="card p-6 space-y-4 hover:shadow-md transition">
            <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h3 class="text-lg font-bold text-ink font-manrope">Suivi du Pipeline Prospect</h3>
            <p class="text-sm text-gray-500 leading-relaxed">
              Suivi en temps réel de l'état d'avancement de chaque dossier, de la qualification initiale par les téléprospecteurs jusqu'à la signature finale.
            </p>
          </div>

          <!-- Card 2 -->
          <div class="card p-6 space-y-4 hover:shadow-md transition">
            <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 class="text-lg font-bold text-ink font-manrope">Intégration Google Agenda</h3>
            <p class="text-sm text-gray-500 leading-relaxed">
              Lecture instantanée des disponibilités des commerciaux (FreeBusy) et création automatique des événements Google Calendar à la validation du rendez-vous.
            </p>
          </div>

          <!-- Card 3 -->
          <div class="card p-6 space-y-4 hover:shadow-md transition">
            <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A2 2 0 013 15.485V5.515a2 2 0 011.553-1.943L9 2.06l5.447 2.724A2 2 0 0115 6.728v9.957a2 2 0 01-1.553 1.943L9 20z" />
              </svg>
            </div>
            <h3 class="text-lg font-bold text-ink font-manrope">Géolocalisation & Itinéraires</h3>
            <p class="text-sm text-gray-500 leading-relaxed">
              Calcul précis de faisabilité des rendez-vous et estimation de la durée de déplacement par Google Routes pour optimiser le temps utile des équipes terrain.
            </p>
          </div>
        </div>
      </section>

      <!-- Section Google Consent -->
      <section class="mt-20 rounded-xl bg-gray-50 border border-gray-150 p-6 space-y-3">
        <h3 class="text-sm font-bold text-ink tracking-wide uppercase">Données utilisateur Google</h3>
        <p class="text-xs text-gray-500 leading-relaxed">
          Le CRM R&A Energy utilise l'authentification sécurisée Google OAuth pour s'associer à votre compte Google Workspace de manière sécurisée. Nous accédons aux API de Google Calendar exclusivement pour interroger les blocs d'indisponibilité (afin d'éviter les doubles réservations) et enregistrer les créneaux qualifiés. Aucune donnée issue de vos services Google n'est transmise à des tiers ou vendue. Pour en savoir plus, consultez notre Politique de Confidentialité.
        </p>
      </section>
    </main>

    <!-- Pied de Page Public -->
    <footer class="mt-auto border-t border-gray-200/60 bg-white">
      <div class="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 md:flex-row text-xs text-gray-400">
        <div>
          © 2026 R&A Energy. Tous droits réservés.
        </div>
        <div class="flex gap-6">
          <NuxtLink to="/politique-de-confidentialite" class="hover:underline hover:text-primary">
            Politique de Confidentialité
          </NuxtLink>
          <NuxtLink to="/conditions-d-utilisation" class="hover:underline hover:text-primary">
            Conditions d'Utilisation
          </NuxtLink>
        </div>
      </div>
    </footer>
  </div>
</template>

