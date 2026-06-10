<script setup lang="ts">
interface Point { label: string, value: number }

const props = defineProps<{ points: Point[] }>()

const W = 520
const H = 160
const PAD = 28

const max = computed(() => Math.max(1, ...props.points.map(p => p.value)))

const coords = computed(() => {
  const n = props.points.length
  if (n === 0) return []
  return props.points.map((p, i) => ({
    ...p,
    x: PAD + (i * (W - 2 * PAD)) / Math.max(1, n - 1),
    y: H - PAD - (p.value / max.value) * (H - 2 * PAD),
  }))
})

const linePath = computed(() =>
  coords.value.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' '))

const areaPath = computed(() => {
  if (!coords.value.length) return ''
  const first = coords.value[0]!
  const last = coords.value[coords.value.length - 1]!
  return `${linePath.value} L${last.x.toFixed(1)},${H - PAD} L${first.x.toFixed(1)},${H - PAD} Z`
})
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="w-full" preserveAspectRatio="none" style="height: 180px">
    <defs>
      <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#31694E" stop-opacity="0.22" />
        <stop offset="100%" stop-color="#31694E" stop-opacity="0" />
      </linearGradient>
    </defs>

    <path :d="areaPath" fill="url(#trendFill)" />
    <path :d="linePath" fill="none" stroke="#31694E" stroke-width="2.5" stroke-linejoin="round" />

    <g v-for="c in coords" :key="c.label">
      <circle :cx="c.x" :cy="c.y" r="3.5" fill="#31694E" />
      <text :x="c.x" :y="H - 8" text-anchor="middle" font-size="10" fill="#9CA3AF">{{ c.label }}</text>
      <text v-if="c.value" :x="c.x" :y="c.y - 8" text-anchor="middle" font-size="10" fill="#31694E" font-weight="600">
        {{ c.value }}
      </text>
    </g>
  </svg>
</template>
