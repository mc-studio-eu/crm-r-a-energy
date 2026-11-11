<script setup lang="ts">
import type { ProspectStatut } from '~~/shared/types'
import { PROSPECT_STATUTS } from '~~/shared/types'

const props = defineProps<{ statut: ProspectStatut }>()

const styles: Record<ProspectStatut, string> = {
  en_cours: 'bg-blue-100 text-blue-800',
  rdv_place: 'bg-secondary-light text-primary',
  signe: 'bg-primary/10 text-primary',
  perdu: 'bg-gray-200 text-gray-600',
}

const label = computed(() => PROSPECT_STATUTS[props.statut])
</script>

<template>
  <span class="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium" :class="styles[statut]">
    {{ label }}
  </span>
</template>
