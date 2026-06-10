<script setup lang="ts">
import { PROSPECT_STATUTS, RDV_STATUTS, type Prospect, type ProspectStatut } from '~~/shared/types'

const route = useRoute()
const supabase = useSupabaseClient()
const { isStaff, isAdmin } = useProfile()

const id = route.params.id as string
const editing = ref(false)
const showRdvForm = ref(false)

const { data: prospect, refresh } = await useAsyncData(`prospect-${id}`, async () => {
  const { data } = await supabase.from('prospects').select('*').eq('id', id).single()
  return data as Prospect | null
})

const { data: rdvs, refresh: refreshRdvs } = await useAsyncData(`rdvs-${id}`, async () => {
  const { data } = await supabase
    .from('rdv')
    .select('*, profiles!rdv_commercial_id_fkey(nom)')
    .eq('prospect_id', id)
    .order('debut', { ascending: false })
  return data ?? []
})

const { data: activites, refresh: refreshActivites } = await useAsyncData(`activites-${id}`, async () => {
  const { data } = await supabase
    .from('prospect_activites')
    .select('*, profiles(nom)')
    .eq('prospect_id', id)
    .order('created_at', { ascending: false })
    .limit(50)
  return data ?? []
})

async function setStatut(statut: ProspectStatut) {
  await supabase.from('prospects').update({ statut }).eq('id', id)
  refresh()
  refreshActivites()
}

async function archiver() {
  if (!confirm('Archiver cette fiche ?')) return
  await supabase.from('prospects').update({ archive: true }).eq('id', id)
  navigateTo('/prospects')
}

function fmtDate(d: string) {
  return new Date(d).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}

function activiteLabel(a: any) {
  if (a.type === 'statut') {
    return `Statut : ${PROSPECT_STATUTS[a.ancien_statut as ProspectStatut] ?? '—'} → ${PROSPECT_STATUTS[a.nouveau_statut as ProspectStatut]}`
  }
  return a.detail ?? a.type
}
</script>

<template>
  <div v-if="prospect" class="max-w-5xl">
    <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <NuxtLink to="/prospects" class="text-sm text-gray-400 hover:text-primary">← Prospects</NuxtLink>
        <h1 class="text-2xl">{{ prospect.raison_sociale }}</h1>
        <div class="mt-1 flex items-center gap-2">
          <StatusBadge :statut="prospect.statut" />
          <span v-if="prospect.siret" class="text-xs text-gray-400">SIRET {{ prospect.siret }}</span>
        </div>
      </div>
      <div class="flex gap-2">
        <select
          class="input !w-auto"
          :value="prospect.statut"
          @change="setStatut(($event.target as HTMLSelectElement).value as ProspectStatut)"
        >
          <option v-for="(label, s) in PROSPECT_STATUTS" :key="s" :value="s">{{ label }}</option>
        </select>
        <button class="btn-secondary" @click="editing = !editing">{{ editing ? 'Annuler' : 'Modifier' }}</button>
        <button v-if="isAdmin" class="btn-danger" @click="archiver">Archiver</button>
      </div>
    </div>

    <div v-if="editing" class="card mb-6">
      <ProspectForm :prospect="prospect" @saved="editing = false; refresh()" />
    </div>

    <div class="grid gap-6 lg:grid-cols-3">
      <!-- Infos -->
      <div class="card space-y-3 text-sm lg:col-span-1">
        <h2 class="text-base">Coordonnées</h2>
        <p><span class="text-gray-400">Contact :</span> {{ prospect.contact_nom || '—' }}</p>
        <p><span class="text-gray-400">Tél :</span> <a :href="`tel:${prospect.telephone}`" class="text-primary">{{ prospect.telephone || '—' }}</a></p>
        <p><span class="text-gray-400">Email :</span> <a :href="`mailto:${prospect.email}`" class="text-primary">{{ prospect.email || '—' }}</a></p>
        <p><span class="text-gray-400">Adresse :</span> {{ [prospect.adresse, prospect.code_postal, prospect.ville].filter(Boolean).join(', ') || '—' }}</p>
        <p v-if="prospect.lat == null" class="text-xs text-amber-600">⚠️ Adresse non géocodée</p>
        <p><span class="text-gray-400">Source :</span> {{ prospect.source || '—' }}</p>
        <p v-if="prospect.notes" class="whitespace-pre-wrap rounded bg-gray-50 p-2">{{ prospect.notes }}</p>
      </div>

      <!-- RDV -->
      <div class="card lg:col-span-2">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-base">Rendez-vous</h2>
          <button v-if="isStaff" class="btn-primary !px-3 !py-1.5 text-xs" @click="showRdvForm = !showRdvForm">
            {{ showRdvForm ? 'Fermer' : '+ Prendre un RDV' }}
          </button>
        </div>
        <div v-if="showRdvForm" class="mb-4 rounded-lg border border-secondary/40 bg-secondary-light/20 p-4">
          <RdvForm :prospect="prospect" @created="showRdvForm = false; refreshRdvs(); refresh(); refreshActivites()" />
        </div>
        <ul class="space-y-2 text-sm">
          <li v-for="r in rdvs" :key="r.id" class="flex items-center justify-between rounded-lg border border-gray-100 p-3">
            <div>
              <p class="font-medium">{{ fmtDate(r.debut) }}</p>
              <p class="text-xs text-gray-500">
                {{ r.profiles?.nom }} · {{ r.lieu }}
                <span v-if="r.temps_trajet_min"> · trajet {{ r.temps_trajet_min }} min</span>
              </p>
            </div>
            <span class="text-xs font-medium" :class="r.statut === 'planifie' ? 'text-primary' : r.statut === 'honore' ? 'text-green-700' : 'text-gray-400'">
              {{ RDV_STATUTS[r.statut] }}
            </span>
          </li>
          <li v-if="!rdvs?.length" class="py-4 text-center text-gray-400">Aucun RDV pour ce prospect.</li>
        </ul>
      </div>
    </div>

    <!-- Historique -->
    <div class="card mt-6">
      <h2 class="mb-3 text-base">Historique d'activité</h2>
      <ul class="space-y-1.5 text-sm">
        <li v-for="a in activites" :key="a.id" class="flex gap-3">
          <span class="shrink-0 text-xs text-gray-400">{{ fmtDate(a.created_at) }}</span>
          <span>{{ activiteLabel(a) }}</span>
          <span class="text-xs text-gray-400">{{ a.profiles?.nom }}</span>
        </li>
        <li v-if="!activites?.length" class="text-gray-400">Aucune activité.</li>
      </ul>
    </div>
  </div>
  <div v-else class="py-20 text-center text-gray-400">Prospect introuvable.</div>
</template>
