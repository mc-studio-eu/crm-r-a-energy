<script setup lang="ts">
import type { ProspectStatut } from '~~/shared/types'
import { PROSPECT_STATUTS } from '~~/shared/types'

const props = defineProps<{ statut: ProspectStatut }>()

const styles: Record<ProspectStatut, string> = {
  nouveau: 'bg-blue-100 text-blue-800',
  a_rappeler: 'bg-amber-100 text-amber-800',
  rdv_place: 'bg-secondary-light text-primary',
  signe: 'bg-green-100 text-green-800',
  perdu: 'bg-gray-200 text-gray-600',
}

const label = computed(() => PROSPECT_STATUTS[props.statut])
</script>

<template>
  <span class="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium" :class="styles[statut]">
    {{ label }}
  </span>
</template>
