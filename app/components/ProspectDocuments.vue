<script setup lang="ts">
import type { ProspectDocument } from '~~/shared/types'

// La carte n'est affichée qu'aux rôles autorisés (admin / régie externe) :
// le formulaire d'upload est donc toujours visible ici, la RLS fait foi côté base.
const props = defineProps<{ prospectId: string }>()
// Émis à chaque action tracée dans l'historique, pour que la page le rafraîchisse.
const emit = defineEmits<{ activite: [] }>()

const supabase = useSupabaseClient()
const userId = useUserId()
const { isAdmin } = useProfile()

const { data: documents, refresh } = await useAsyncData(`documents-${props.prospectId}`, async () => {
  const { data } = await supabase
    .from('prospect_documents')
    .select('*, profiles(nom)')
    .eq('prospect_id', props.prospectId)
    .order('created_at', { ascending: false })
  return (data ?? []) as (ProspectDocument & { profiles: { nom: string } | null })[]
})

const DOCUMENTS_PAR_PAGE = 5
const page = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil((documents.value?.length ?? 0) / DOCUMENTS_PAR_PAGE)))
const documentsPagines = computed(() =>
  (documents.value ?? []).slice((page.value - 1) * DOCUMENTS_PAR_PAGE, page.value * DOCUMENTS_PAR_PAGE),
)
watch(totalPages, (total) => {
  if (page.value > total) page.value = total
})

const fileInput = ref<HTMLInputElement | null>(null)
const nomDocument = ref('')
const fichier = ref<File | null>(null)
const uploading = ref(false)
const error = ref('')

function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0] ?? null
  fichier.value = file
  // Pré-remplit le nom avec celui du fichier (sans extension) si vide.
  if (file && !nomDocument.value) {
    nomDocument.value = file.name.replace(/\.[^.]+$/, '')
  }
}

async function upload() {
  if (!fichier.value || !nomDocument.value.trim()) return
  uploading.value = true
  error.value = ''

  const ext = fichier.value.name.split('.').pop()?.toLowerCase() ?? 'bin'
  const path = `${props.prospectId}/${crypto.randomUUID()}.${ext}`

  const { error: upErr } = await supabase.storage
    .from('prospect-documents')
    .upload(path, fichier.value)
  if (upErr) { error.value = upErr.message; uploading.value = false; return }

  const { error: insErr } = await supabase.from('prospect_documents').insert({
    prospect_id: props.prospectId,
    nom: nomDocument.value.trim(),
    storage_path: path,
    mime_type: fichier.value.type || null,
    taille: fichier.value.size,
    uploade_par: userId.value,
  })
  if (insErr) {
    // Ne pas laisser d'objet orphelin si l'insertion échoue.
    await supabase.storage.from('prospect-documents').remove([path])
    error.value = insErr.message
    uploading.value = false
    return
  }

  await supabase.from('prospect_activites').insert({
    prospect_id: props.prospectId,
    auteur_id: userId.value,
    type: 'document',
    detail: `Document ajouté : ${nomDocument.value.trim()}`,
  })
  emit('activite')

  nomDocument.value = ''
  fichier.value = null
  if (fileInput.value) fileInput.value.value = ''
  uploading.value = false
  page.value = 1
  refresh()
}

async function telecharger(doc: ProspectDocument) {
  error.value = ''
  const ext = doc.storage_path.split('.').pop()
  const { data, error: err } = await supabase.storage
    .from('prospect-documents')
    .createSignedUrl(doc.storage_path, 60, { download: `${doc.nom}.${ext}` })
  if (err || !data) { error.value = err?.message ?? 'Téléchargement impossible.'; return }
  window.open(data.signedUrl, '_blank')
}

function peutSupprimer(doc: ProspectDocument) {
  return isAdmin.value || doc.uploade_par === userId.value
}

async function supprimer(doc: ProspectDocument) {
  if (!confirm(`Supprimer le document « ${doc.nom} » ?`)) return
  error.value = ''
  const { error: delErr } = await supabase.from('prospect_documents').delete().eq('id', doc.id)
  if (delErr) { error.value = delErr.message; return }
  await supabase.storage.from('prospect-documents').remove([doc.storage_path])
  await supabase.from('prospect_activites').insert({
    prospect_id: props.prospectId,
    auteur_id: userId.value,
    type: 'document',
    detail: `Document supprimé : ${doc.nom}`,
  })
  emit('activite')
  refresh()
}

function fmtTaille(octets: number | null) {
  if (octets == null) return ''
  if (octets < 1024 * 1024) return `${Math.max(1, Math.round(octets / 1024))} Ko`
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { dateStyle: 'medium' })
}
</script>

<template>
  <div class="card">
    <h2 class="mb-3 text-base">Documents</h2>

    <form class="mb-4 space-y-2" @submit.prevent="upload">
      <div class="flex flex-wrap gap-2">
        <input
          ref="fileInput" type="file" class="input !w-auto flex-1 text-sm"
          @change="onFileChange"
        >
        <input
          v-model="nomDocument" class="input !w-auto flex-1" placeholder="Nom du document (Contrat, RIB…)" required
        >
        <button type="submit" class="btn-primary whitespace-nowrap" :disabled="uploading || !fichier">
          {{ uploading ? 'Envoi…' : 'Ajouter' }}
        </button>
      </div>
    </form>

    <p v-if="error" class="mb-2 text-sm text-red-600">{{ error }}</p>

    <ul class="space-y-2 text-sm">
      <li
        v-for="doc in documentsPagines" :key="doc.id"
        class="flex items-center justify-between gap-3 rounded-lg border border-gray-100 p-3"
      >
        <div class="min-w-0">
          <button class="block max-w-full truncate font-medium text-primary hover:underline" @click="telecharger(doc)">
            {{ doc.nom }}
          </button>
          <p class="text-xs text-gray-500">
            {{ fmtDate(doc.created_at) }}
            <span v-if="doc.taille"> · {{ fmtTaille(doc.taille) }}</span>
            <span v-if="doc.profiles?.nom"> · {{ displayName(doc.profiles.nom) }}</span>
          </p>
        </div>
        <button
          v-if="peutSupprimer(doc)" class="shrink-0 text-xs text-red-600 hover:underline"
          @click="supprimer(doc)"
        >
          Supprimer
        </button>
      </li>
      <li v-if="!documents?.length" class="py-4 text-center text-gray-400">Aucun document.</li>
    </ul>
    <div v-if="totalPages > 1" class="mt-4 flex items-center justify-between text-xs">
      <button class="btn-secondary !px-3 !py-1.5" :disabled="page <= 1" @click="page--">
        ← Précédent
      </button>
      <span class="text-gray-400">Page {{ page }} / {{ totalPages }}</span>
      <button class="btn-secondary !px-3 !py-1.5" :disabled="page >= totalPages" @click="page++">
        Suivant →
      </button>
    </div>
  </div>
</template>
