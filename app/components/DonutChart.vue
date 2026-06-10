<script setup lang="ts">
interface Segment { label: string, value: number, color: string }

const props = defineProps<{ segments: Segment[], size?: number, thickness?: number }>()

const size = computed(() => props.size ?? 180)
const thickness = computed(() => props.thickness ?? 22)
const radius = computed(() => (size.value - thickness.value) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const total = computed(() => props.segments.reduce((s, x) => s + x.value, 0))

// Construit les arcs (offset cumulé) à partir des segments non nuls.
const arcs = computed(() => {
  if (total.value === 0) return []
  let acc = 0
  return props.segments
    .filter(s => s.value > 0)
    .map((s) => {
      const fraction = s.value / total.value
      const dash = fraction * circumference.value
      const arc = {
        ...s,
        dasharray: `${dash} ${circumference.value - dash}`,
        dashoffset: -acc * circumference.value,
      }
      acc += fraction
      return arc
    })
})
</script>

<template>
  <div class="flex items-center gap-5">
    <div class="relative shrink-0" :style="{ width: `${size}px`, height: `${size}px` }">
      <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`" class="-rotate-90">
        <circle
          :cx="size / 2" :cy="size / 2" :r="radius"
          fill="none" stroke="#F1F1EC" :stroke-width="thickness"
        />
        <circle
          v-for="arc in arcs" :key="arc.label"
          :cx="size / 2" :cy="size / 2" :r="radius"
          fill="none" :stroke="arc.color" :stroke-width="thickness"
          :stroke-dasharray="arc.dasharray" :stroke-dashoffset="arc.dashoffset"
          stroke-linecap="butt"
        />
      </svg>
      <div class="absolute inset-0 flex flex-col items-center justify-center">
        <span class="text-2xl font-bold text-primary" style="font-family: Manrope, sans-serif">{{ total }}</span>
        <span class="text-xs text-gray-400">prospects</span>
      </div>
    </div>

    <ul class="space-y-1.5 text-sm">
      <li v-for="s in segments" :key="s.label" class="flex items-center gap-2">
        <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ background: s.color }" />
        <span class="text-gray-600">{{ s.label }}</span>
        <span class="ml-auto font-medium tabular-nums">{{ s.value }}</span>
        <span class="w-10 text-right text-xs text-gray-400 tabular-nums">
          {{ total ? Math.round((s.value / total) * 100) : 0 }}%
        </span>
      </li>
    </ul>
  </div>
</template>
