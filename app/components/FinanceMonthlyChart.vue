<script setup lang="ts">
import { financeEuros, type FinanceType } from '~~/shared/finance'

const props = defineProps<{
  title: string
  months: { id: number, label: string }[]
  series: { key: FinanceType, label: string, color: string }[]
  values: { mois: number, type: FinanceType, montant_cents: string | null }[]
}>()
const emit = defineEmits<{ select: [month: number, type: FinanceType] }>()
function value(month: number, type: FinanceType): string | null {
  return props.values.find(v => v.mois === month && v.type === type)?.montant_cents ?? null
}
const maximum = computed(() => props.values.filter(v => props.series.some(s => s.key === v.type))
  .reduce((max, v) => { const n = BigInt(v.montant_cents ?? '0'); return n > max ? n : max }, 1n))
function height(month: number, type: FinanceType) {
  return Number(BigInt(value(month, type) ?? '0') * 10000n / maximum.value) / 100
}
</script>

<template>
  <figure class="card min-w-0">
    <figcaption class="mb-3 font-semibold">{{ title }}</figcaption>
    <ul class="mb-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
      <li v-for="s in series" :key="s.key" class="flex items-center gap-1"><span class="inline-block h-2 w-2 rounded" :style="{ background: s.color }" />{{ s.label }}</li>
    </ul>
    <div class="flex h-44 items-end gap-2 border-b border-gray-200" role="group" :aria-label="title">
      <div v-for="month in months" :key="month.id" class="flex h-full min-w-0 flex-1 items-end justify-center gap-px">
        <button
          v-for="s in series" :key="s.key" type="button"
          class="min-h-1 min-w-1 flex-1 rounded-t-sm transition-opacity hover:opacity-70 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-primary disabled:opacity-20"
          :disabled="value(month.id, s.key) === null"
          :style="{ height: `${height(month.id, s.key)}%`, background: s.color }"
          :title="`${month.label} — ${s.label} : ${financeEuros(value(month.id, s.key))} HT`"
          :aria-label="`${month.label} — ${s.label} : ${financeEuros(value(month.id, s.key))} HT. Voir le détail.`"
          @click="emit('select', month.id, s.key)"
        />
      </div>
    </div>
    <div class="mt-2 flex gap-2 text-center text-[10px] text-gray-500"><span v-for="month in months" :key="month.id" class="min-w-0 flex-1 truncate">{{ month.label.slice(0, 3) }}</span></div>
    <p class="mt-3 text-xs text-gray-500">Survolez une barre pour le montant HT ; cliquez pour afficher les dossiers correspondants.</p>
  </figure>
</template>
