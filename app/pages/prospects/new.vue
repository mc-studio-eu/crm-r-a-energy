<script setup lang="ts">
import type { Societe } from '~~/shared/types'

definePageMeta({ key: route => route.fullPath })

const route = useRoute()
const supabase = useSupabaseClient()
const { isStaff, isRegie } = useProfile()
const societeId = typeof route.query.societe === 'string' ? route.query.societe : ''
const { data } = await useAsyncData(`nouveau-dossier-${societeId}`, async () => {
  if (!societeId) return { societe: null }
  const { data } = await supabase.from('societes')
    .select('id, raison_sociale, siret')
    .eq('id', societeId)
    .maybeSingle()
  return { societe: data as Societe | null }
})
</script>

<template>
  <div class="max-w-3xl">
    <h1 class="mb-6 text-2xl">Nouveau dossier</h1>
    <div v-if="!isStaff && !isRegie" class="card">
      <p class="text-sm text-gray-600">La création de dossiers est réservée aux administrateurs, aux téléprospecteurs et aux régies.</p>
      <NuxtLink to="/prospects" class="mt-3 inline-block text-sm text-primary hover:underline">Retour aux dossiers</NuxtLink>
    </div>
    <div v-else-if="societeId && !data?.societe" class="card">
      <p class="text-sm text-gray-600">Société inaccessible ou introuvable.</p>
      <NuxtLink to="/societes" class="mt-3 inline-block text-sm text-primary hover:underline">Retour aux sociétés</NuxtLink>
    </div>
    <div v-else class="card">
      <ProspectForm :initial-societe="data?.societe" @saved="id => navigateTo(`/prospects/${id}`)" />
    </div>
  </div>
</template>
