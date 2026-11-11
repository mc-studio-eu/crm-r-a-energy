<script setup lang="ts">
import { financeEuros, type FinanceType } from '~~/shared/finance'

const props = defineProps<{
  title: string
  months: { id: number, label: string }[]
  series: { key: FinanceType, label: string, color: string }[]
  values: { mois: number, type: FinanceType, montant_cents: string | null }[]
}>()
const emit = defineEmits<{ select: [month: number, type: FinanceType] }>()
const totals = computed(() => {
  const visibleMonths = new Set(props.months.map(month => month.id))
  return Object.fromEntries(props.series.map(series => {
    const rows = props.values.filter(row => row.type === series.key && visibleMonths.has(row.mois))
    const total = rows.some(row => row.montant_cents === null)
      ? null
      : rows.reduce((sum, row) => sum + BigInt(row.montant_cents!), 0n).toString()
    return [series.key, total]
  }))
})
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
    <ul class="mb-5 grid grid-cols-2 gap-3" aria-live="polite">
      <li v-for="s in series" :key="s.key" class="min-w-0">
        <span class="flex items-center gap-1.5 text-xs text-gray-600">
          <span class="inline-block h-2 w-2 shrink-0 rounded" :style="{ background: s.color }" />{{ s.label }}
        </span>
        <strong class="mt-1 block break-words text-lg tabular-nums">{{ financeEuros(totals[s.key] ?? null) }} <span class="text-xs font-normal text-gray-500">HT</span></strong>
      </li>
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
    <p class="mt-3 text-xs text-gray-500">Totaux HT sur la période sélectionnée. Cliquez sur une barre pour afficher les dossiers correspondants.</p>
  </figure>
</template>
