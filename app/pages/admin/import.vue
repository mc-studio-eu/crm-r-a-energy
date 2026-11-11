<script setup lang="ts">
import { FOURNISSEURS, PROSPECT_STATUTS, type ProspectStatut } from '~~/shared/types'
import {
  IMPORT_COLUMNS, IMPORT_COLUMN_KEYS, IMPORT_MAX_BYTES, IMPORT_MAX_COLUMNS, IMPORT_MAX_MB, IMPORT_MAX_ROWS,
  inferImportMapping,
  type ImportColumn, type ImportMapping, type ImportPreview,
  type ImportResult, type ImportRow, type ImportSelection, type ImportSheet, type ImportStatusMapping,
} from '~~/shared/import-dossiers'

const workbook = ref('')
const sheets = ref<ImportSheet[]>([])
const sheetIndex = ref(0)
const mapping = ref<ImportMapping>({})
const statuses = ref<ImportStatusMapping>({})
const previewStatuses = ref('')
const preview = ref<ImportPreview | null>(null)
const selected = ref<number[]>([])
const confirmation = ref<{ selection: string, batch: string } | null>(null)
const result = ref<ImportResult | null>(null)
const busy = ref(false)
const error = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const PAGE_SIZE = 25
const page = ref(1)
const sheet = computed(() => sheets.value[sheetIndex.value])
const validMapping = computed(() => Boolean(sheet.value?.rows)
  && IMPORT_COLUMN_KEYS.every(key => !IMPORT_COLUMNS[key].required || mapping.value[key] !== undefined)
  && Object.values(mapping.value).length === new Set(Object.values(mapping.value)).size)
const pendingStatuses = computed(() => previewStatuses.value !== JSON.stringify(statuses.value))
const selectedLines = computed(() => new Set(selected.value))
const totalPages = computed(() => Math.max(1, Math.ceil((preview.value?.rows.length ?? 0) / PAGE_SIZE)))
const visibleRows = computed(() => preview.value?.rows.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE) ?? [])
const errorCount = computed(() => preview.value?.rows.filter(row => row.errors.length).length ?? 0)
const profileName = computed(() => new Map(preview.value?.profiles.map(profile => [profile.id, profile.nom])))
const currency = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })

function isPotentialDuplicate(row: ImportRow) {
  return row.duplicateInCrm || row.duplicateInFile
}

const selection = computed<ImportSelection[]>(() => (preview.value?.rows ?? [])
  .filter(row => selectedLines.value.has(row.line) && !row.errors.length)
  .map(row => ({ line: row.line, allowDuplicate: isPotentialDuplicate(row) })))

function resetPreview() {
  preview.value = null
  statuses.value = {}
  selected.value = []
  confirmation.value = null
  page.value = 1
}

function selectSheet() {
  resetPreview()
  mapping.value = inferImportMapping(sheet.value?.headers ?? [])
}

function selectMapping(key: ImportColumn, event: Event) {
  resetPreview()
  const value = (event.target as HTMLSelectElement).value
  if (value === '') mapping.value = Object.fromEntries(Object.entries(mapping.value).filter(([field]) => field !== key))
  else mapping.value[key] = Number(value)
}

function columnLetter(index: number) {
  let value = index + 1
  let label = ''
  while (value > 0) {
    value--
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26)
  }
  return label
}

async function run(action: () => Promise<void>) {
  error.value = ''
  busy.value = true
  try {
    await action()
  } catch (cause) {
    const failure = cause as { data?: { message?: string }, message?: string }
    error.value = failure.data?.message ?? failure.message ?? 'Une erreur est survenue pendant l’import.'
  } finally {
    busy.value = false
  }
}

function readWorkbook(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Impossible de lire le fichier sélectionné.'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.readAsDataURL(file)
  })
}

function resetFile(clearInput = true) {
  resetPreview()
  result.value = null
  workbook.value = ''
  sheets.value = []
  sheetIndex.value = 0
  mapping.value = {}
  error.value = ''
  if (clearInput && fileInput.value) fileInput.value.value = ''
}

async function chooseFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  resetFile(false)
  if (!file) return
  if (!file.name.toLowerCase().endsWith('.xlsx') || !file.size || file.size > IMPORT_MAX_BYTES) {
    error.value = `Sélectionnez un fichier XLSX de ${IMPORT_MAX_MB} Mo maximum.`
    return
  }
  await run(async () => {
    const contents = await readWorkbook(file)
    sheets.value = await $fetch<ImportSheet[]>('/api/import', { method: 'POST', body: { step: 'sheets', workbook: contents } })
    workbook.value = contents
    selectSheet()
  })
}

function requestDetails() {
  return { workbook: workbook.value, sheet: sheetIndex.value, mapping: mapping.value, statuses: statuses.value }
}

async function showPreview() {
  if (!validMapping.value) return
  await run(async () => {
    preview.value = await $fetch<ImportPreview>('/api/import', { method: 'POST', body: { step: 'preview', ...requestDetails() } })
    previewStatuses.value = JSON.stringify(statuses.value)
    selected.value = preview.value.rows.filter(row => !row.errors.length && !isPotentialDuplicate(row)).map(row => row.line)
    confirmation.value = null
    page.value = 1
  })
}

function mapStatus(key: string, event: Event) {
  const value = (event.target as HTMLSelectElement).value as ProspectStatut | ''
  if (value) statuses.value = { ...statuses.value, [key]: value }
  else statuses.value = Object.fromEntries(Object.entries(statuses.value).filter(([status]) => status !== key))
}

async function confirmImport() {
  if (busy.value || pendingStatuses.value || !selection.value.length) return
  await run(async () => {
    const serialized = JSON.stringify(selection.value)
    if (confirmation.value?.selection !== serialized) {
      confirmation.value = { selection: serialized, batch: crypto.randomUUID() }
    }
    result.value = await $fetch<ImportResult>('/api/import', {
      method: 'POST',
      body: { step: 'confirm', ...requestDetails(), batch: confirmation.value.batch, selection: selection.value },
    })
    workbook.value = ''
  })
}
</script>

<template>
  <div class="space-y-5">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <NuxtLink to="/prospects" class="mb-2 inline-block text-sm text-primary hover:underline">← Dossiers</NuxtLink>
        <h1 class="text-2xl">Importer des dossiers Excel</h1>
      </div>
      <a class="btn-secondary" href="/api/import/template" download>Télécharger le modèle XLSX</a>
    </header>

    <p v-if="error" role="alert" class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{{ error }}</p>

    <section v-if="result" class="card space-y-4" aria-labelledby="import-success">
      <h2 id="import-success" role="status" class="text-lg font-semibold text-primary">
        {{ result.count }} {{ result.count === 1 ? 'dossier importé' : 'dossiers importés' }}
      </h2>
      <ul class="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <li v-for="dossier in result.dossiers.slice(0, 10)" :key="dossier.id">
          <NuxtLink :to="`/prospects/${dossier.id}`" class="text-primary underline">Dossier ligne {{ dossier.line }}</NuxtLink>
        </li>
      </ul>
      <div class="flex flex-wrap gap-3">
        <NuxtLink to="/prospects" class="btn-primary">Voir les dossiers</NuxtLink>
        <button type="button" class="btn-secondary" @click="resetFile()">Nouvel import</button>
      </div>
    </section>

    <template v-else>
      <section class="card space-y-4" aria-labelledby="import-file">
        <h2 id="import-file" class="text-base font-semibold">Classeur et feuille</h2>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="import-workbook">Fichier XLSX</label>
            <input id="import-workbook" ref="fileInput" :disabled="busy" class="input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="chooseFile">
          </div>
          <div v-if="sheets.length">
            <label class="label" for="import-sheet">Feuille</label>
            <select id="import-sheet" v-model.number="sheetIndex" :disabled="busy" class="input" @change="selectSheet">
              <option v-for="(entry, index) in sheets" :key="entry.name" :value="index">{{ entry.name }} ({{ entry.rows }} lignes)</option>
            </select>
          </div>
        </div>
        <p class="text-sm text-gray-600">{{ IMPORT_MAX_MB }} Mo maximum, {{ IMPORT_MAX_ROWS }} lignes de données et {{ IMPORT_MAX_COLUMNS }} colonnes par feuille. La première ligne contient les en-têtes.</p>
        <p v-if="sheet && !sheet.rows" class="text-sm text-gray-600">Cette feuille ne contient aucune ligne à importer.</p>
      </section>

      <section v-if="sheet?.rows" class="card space-y-4" aria-labelledby="import-mapping">
        <h2 id="import-mapping" class="text-base font-semibold">Correspondance des colonnes</h2>
        <p class="text-sm text-gray-600">Une commission vide reste inconnue. Saisissez 0 pour une commission nulle.</p>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="key in IMPORT_COLUMN_KEYS" :key="key">
            <label class="label" :for="`import-col-${key}`">
              {{ IMPORT_COLUMNS[key].label }} <span v-if="IMPORT_COLUMNS[key].required" class="text-primary">*</span>
            </label>
            <select :id="`import-col-${key}`" :value="mapping[key] ?? ''" :disabled="busy" class="input" @change="selectMapping(key, $event)">
              <option value="">{{ IMPORT_COLUMNS[key].required ? 'Choisir une colonne' : 'Ignorer ce champ' }}</option>
              <option v-for="(header, index) in sheet.headers" :key="index" :value="index" :disabled="mapping[key] !== index && Object.values(mapping).includes(index)">
                {{ columnLetter(index) }} — {{ header || 'Sans en-tête' }}
              </option>
            </select>
          </div>
        </div>
        <button type="button" class="btn-secondary" :disabled="!validMapping || busy" @click="showPreview">{{ preview ? 'Actualiser l’aperçu' : 'Afficher l’aperçu' }}</button>
      </section>

      <section v-if="preview?.unknownStatuses.length" class="card space-y-4" aria-labelledby="import-statuses">
        <h2 id="import-statuses" class="text-base font-semibold">Statuts à associer</h2>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="(status, index) in preview.unknownStatuses" :key="status.key">
            <label class="label break-words" :for="`import-status-${index}`">{{ status.label }}</label>
            <select :id="`import-status-${index}`" :value="Object.hasOwn(statuses, status.key) ? statuses[status.key] : ''" :disabled="busy" class="input" @change="mapStatus(status.key, $event)">
              <option value="">Choisir un statut CRM</option>
              <option v-for="(label, key) in PROSPECT_STATUTS" :key="key" :value="key">{{ label }}</option>
            </select>
          </div>
        </div>
        <button type="button" class="btn-secondary" :disabled="busy || !pendingStatuses" @click="showPreview">Appliquer les correspondances</button>
      </section>

      <section v-if="preview" class="card space-y-4" aria-labelledby="import-preview">
        <div class="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="import-preview" class="text-base font-semibold">Aperçu des dossiers</h2>
          <p class="text-sm text-gray-600" aria-live="polite">{{ preview.rows.length }} lignes · {{ errorCount }} en erreur · {{ selected.length }} sélectionnées</p>
        </div>
        <p v-if="preview.rows.some(isPotentialDuplicate)" class="text-sm text-gray-600">Les doublons potentiels sont décochés par défaut. Cochez une ligne pour créer un dossier distinct.</p>
        <div class="overflow-x-auto">
          <table class="table-base min-w-[48rem]">
            <thead>
              <tr>
                <th scope="col">Importer</th>
                <th scope="col">Ligne</th>
                <th scope="col">Dossier</th>
                <th scope="col">Commission HT</th>
                <th scope="col">Vérification</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in visibleRows" :key="row.line" class="align-top">
                <td><input v-model="selected" :aria-label="isPotentialDuplicate(row) ? `Créer un dossier distinct pour la ligne ${row.line}` : `Importer la ligne ${row.line}`" :value="row.line" :disabled="busy || row.errors.length > 0" type="checkbox" class="accent-primary"></td>
                <td>{{ row.line }}</td>
                <td class="max-w-sm">
                  <div class="break-words font-medium">{{ row.dossier.raison_sociale || 'Société manquante' }}</div>
                  <div class="text-sm text-gray-600">
                    <span v-if="row.dossier.siret">{{ row.dossier.siret }} · </span>
                    {{ row.dossier.statut ? PROSPECT_STATUTS[row.dossier.statut] : row.statusLabel || 'Statut manquant' }}
                  </div>
                  <dl class="mt-1 text-xs text-gray-600">
                    <div v-if="row.dossier.fournisseur || row.dossier.energie">
                      {{ row.dossier.fournisseur ? FOURNISSEURS[row.dossier.fournisseur] : '' }}
                      {{ row.dossier.energie === 'gaz' ? 'Gaz' : row.dossier.energie === 'electricite' ? 'Électricité' : '' }}
                    </div>
                    <div v-if="row.dossier.date_signature"><dt class="inline">Signature</dt> <dd class="inline">{{ row.dossier.date_signature }}</dd></div>
                    <div v-if="row.dossier.debut_livraison"><dt class="inline">Début de livraison</dt> <dd class="inline">{{ row.dossier.debut_livraison }}</dd></div>
                    <div v-if="row.dossier.fin_livraison"><dt class="inline">Fin de livraison</dt> <dd class="inline">{{ row.dossier.fin_livraison }}</dd></div>
                    <div v-if="row.dossier.assigne_a"><dt class="inline">Commercial ou régie</dt> <dd class="inline">{{ profileName.get(row.dossier.assigne_a) }}</dd></div>
                    <div v-if="row.dossier.teleprospecteur_id"><dt class="inline">Téléprospecteur</dt> <dd class="inline">{{ profileName.get(row.dossier.teleprospecteur_id) }}</dd></div>
                  </dl>
                </td>
                <td class="whitespace-nowrap">{{ row.dossier.commission_cents === null ? 'Inconnue' : currency.format(row.dossier.commission_cents / 100) }}</td>
                <td class="min-w-64">
                  <ul v-if="row.errors.length" class="list-inside list-disc text-sm text-red-800">
                    <li v-for="issue in row.errors" :key="issue">{{ issue }}</li>
                  </ul>
                  <span v-else-if="isPotentialDuplicate(row)" class="text-sm text-amber-800">
                    {{ row.duplicateInCrm ? 'Doublon potentiel dans les dossiers' : 'Doublon potentiel dans la feuille' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="totalPages > 1" class="flex flex-wrap items-center justify-center gap-3 text-sm">
          <button type="button" class="btn-secondary" :disabled="page <= 1 || busy" @click="page--">Précédente</button>
          <span>Page {{ page }} / {{ totalPages }}</span>
          <button type="button" class="btn-secondary" :disabled="page >= totalPages || busy" @click="page++">Suivante</button>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <button type="button" class="btn-primary" :disabled="busy || pendingStatuses || !selection.length" @click="confirmImport">
            Confirmer l’import de {{ selection.length }} {{ selection.length === 1 ? 'dossier' : 'dossiers' }}
          </button>
          <span v-if="busy" role="status" class="text-sm text-gray-600">Traitement en cours…</span>
        </div>
      </section>
      <p v-else-if="busy" role="status" class="text-sm text-gray-600">Lecture en cours…</p>
    </template>
  </div>
</template>
