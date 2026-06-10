<script setup lang="ts">
interface Bar { label: string, value: number, color: string }

const props = defineProps<{ bars: Bar[] }>()
const max = computed(() => Math.max(1, ...props.bars.map(b => b.value)))
</script>

<template>
  <ul class="space-y-3">
    <li v-for="b in bars" :key="b.label">
      <div class="mb-1 flex items-center justify-between text-sm">
        <span class="text-gray-600">{{ b.label }}</span>
        <span class="font-medium tabular-nums">{{ b.value }}</span>
      </div>
      <div class="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          class="h-full rounded-full transition-all duration-500"
          :style="{ width: `${(b.value / max) * 100}%`, background: b.color }"
        />
      </div>
    </li>
  </ul>
</template>
