<script setup lang="ts">
import type { RdvStatut } from '~~/shared/types'
import { RDV_STATUTS } from '~~/shared/types'

const supabase = useSupabaseClient()

// Décalage en jours par rapport à aujourd'hui (0 = aujourd'hui).
const jour = ref(0)

const bornes = computed(() => {
  const debut = new Date()
  debut.setDate(debut.getDate() + jour.value)
  debut.setHours(0, 0, 0, 0)
  const fin = new Date(debut)
  fin.setDate(fin.getDate() + 1)
  return { debut: debut.toISOString(), fin: fin.toISOString(), date: debut }
})

interface RdvRow {
  id: string
  debut: string
  fin: string
  lieu: string | null
  lieu_lat: number | null
  lieu_lng: number | null
  statut: RdvStatut
  prospects: { id: string, raison_sociale: string, ville: string | null } | null
  profiles: { id: string, nom: string } | null
}

const { data: rdvs } = await useAsyncData('carte-rdv', async () => {
  const { data } = await supabase
    .from('rdv')
    .select('id, debut, fin, lieu, lieu_lat, lieu_lng, statut, prospects(id, raison_sociale, ville), profiles!rdv_commercial_id_fkey(id, nom)')
    .gte('debut', bornes.value.debut)
    .lt('debut', bornes.value.fin)
    .order('debut')
  return (data ?? []) as unknown as RdvRow[]
}, { watch: [jour] })

// Palette stable assignée par commercial.
const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d']

const commerciaux = computed(() => {
  const map = new Map<string, { id: string, nom: string, color: string, count: number }>()
  for (const r of rdvs.value ?? []) {
    const p = r.profiles
    if (!p?.id) continue
    if (!map.has(p.id)) {
      map.set(p.id, { id: p.id, nom: displayName(p.nom), color: PALETTE[map.size % PALETTE.length]!, count: 0 })
    }
    map.get(p.id)!.count++
  }
  return [...map.values()]
})

// Filtre : ids de commerciaux masqués.
const masques = ref<Set<string>>(new Set())
function toggle(id: string) {
  const next = new Set(masques.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  masques.value = next
}

const rdvVisibles = computed(() =>
  (rdvs.value ?? [])
    .filter(r => r.lieu_lat != null && r.lieu_lng != null)
    .filter(r => !(r.profiles && masques.value.has(r.profiles.id))))

const sansCoords = computed(() =>
  (rdvs.value ?? []).filter(r => r.lieu_lat == null || r.lieu_lng == null).length)

const fmtHeure = (d: string) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

// --- Leaflet (chargé via CDN, aucune dépendance ajoutée au build) ---
// Typage minimal de la surface Leaflet réellement utilisée (pas de @types installés).
type LatLng = [number, number]
interface LMarker { bindPopup: (html: string) => LMarker, addTo: (l: LLayer) => LMarker }
interface LLayer { addTo: (m: LMap) => LLayer, clearLayers: () => void }
interface LMap {
  setView: (c: LatLng, z: number) => LMap
  fitBounds: (pts: LatLng[], opts?: object) => void
  remove: () => void
}
interface Leaflet {
  map: (el: HTMLElement) => LMap
  tileLayer: (url: string, opts: object) => { addTo: (m: LMap) => void }
  layerGroup: () => LLayer
  divIcon: (opts: object) => object
  marker: (c: LatLng, opts: object) => LMarker
}

const mapEl = ref<HTMLElement | null>(null)
let map: LMap | null = null
let markersLayer: LLayer | null = null
let L: Leaflet | null = null

function loadLeaflet(): Promise<Leaflet> {
  const w = window as unknown as { L?: Leaflet }
  if (w.L) return Promise.resolve(w.L)
  return new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const css = document.createElement('link')
      css.rel = 'stylesheet'
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      css.setAttribute('data-leaflet', '')
      document.head.appendChild(css)
    }
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => resolve(w.L!)
    script.onerror = reject
    document.body.appendChild(script)
  })
}

function colorFor(id: string) {
  return commerciaux.value.find(c => c.id === id)?.color ?? '#64748b'
}

function pinIcon(color: string) {
  return L!.divIcon({
    className: '',
    html: `<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 18],
    popupAnchor: [0, -18],
  })
}

function render() {
  if (!map || !L || !markersLayer) return
  markersLayer.clearLayers()
  const pts: LatLng[] = []
  for (const r of rdvVisibles.value) {
    const lat = r.lieu_lat as number
    const lng = r.lieu_lng as number
    const p = r.prospects
    const c = r.profiles
    const color = colorFor(c?.id ?? '')
    const popup = `
      <div style="font-size:13px;line-height:1.5">
        <strong>${fmtHeure(r.debut)} — ${p?.raison_sociale ?? 'Prospect'}</strong><br>
        ${p?.ville ?? ''}<br>
        <span style="color:${color}">● ${displayName(c?.nom)}</span> · ${RDV_STATUTS[r.statut] ?? r.statut}<br>
        <a href="/prospects/${p?.id}" style="color:#2563eb">Voir la fiche</a>
      </div>`
    L.marker([lat, lng], { icon: pinIcon(color) }).bindPopup(popup).addTo(markersLayer)
    pts.push([lat, lng])
  }
  if (pts.length) map.fitBounds(pts, { padding: [50, 50], maxZoom: 12 })
}

onMounted(async () => {
  L = await loadLeaflet()
  map = L.map(mapEl.value).setView([46.6, 2.4], 6) // centre France
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  }).addTo(map)
  markersLayer = L.layerGroup().addTo(map)
  render()
})

watch([rdvVisibles], () => render())

onBeforeUnmount(() => {
  map?.remove()
  map = null
})

const fmtDate = (d: Date) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl">Carte des RDV</h1>
      <div class="flex items-center gap-2 text-sm">
        <button class="btn-secondary !px-3 !py-1" @click="jour--">←</button>
        <span class="font-medium capitalize">{{ fmtDate(bornes.date) }}</span>
        <button class="btn-secondary !px-3 !py-1" @click="jour++">→</button>
        <button v-if="jour !== 0" class="btn-secondary !px-3 !py-1" @click="jour = 0">Aujourd'hui</button>
      </div>
    </div>

    <!-- Légende / filtres par commercial -->
    <div v-if="commerciaux.length" class="mb-4 flex flex-wrap gap-2">
      <button
        v-for="c in commerciaux"
        :key="c.id"
        class="flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition"
        :class="masques.has(c.id) ? 'border-gray-200 text-gray-400' : 'border-gray-300'"
        @click="toggle(c.id)"
      >
        <span class="h-3 w-3 rounded-full" :style="{ background: masques.has(c.id) ? '#cbd5e1' : c.color }" />
        {{ c.nom }}
        <span class="text-xs text-gray-400">({{ c.count }})</span>
      </button>
    </div>

    <div ref="mapEl" class="h-[70vh] w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-100" />

    <p v-if="!commerciaux.length" class="py-6 text-center text-gray-400">
      Aucun RDV ce jour-là.
    </p>
    <p v-else-if="sansCoords" class="mt-2 text-sm text-amber-600">
      ⚠️ {{ sansCoords }} RDV non affiché(s) faute de coordonnées (adresse non géocodée).
    </p>
  </div>
</template>
