<script setup lang="ts">
defineProps<{
  modelValue: 'pulse' | 'sequence'
}>()

const emit = defineEmits<{
  'update:modelValue': [mode: 'pulse' | 'sequence']
}>()
</script>

<template>
  <div class="mode-selector" role="group" aria-label="Mode de lecture">
    <button
      class="mode-button"
      :class="{ 'mode-button-active': modelValue === 'pulse' }"
      type="button"
      :aria-pressed="modelValue === 'pulse'"
      @click="emit('update:modelValue', 'pulse')"
    >
      Pulse
    </button>
    <button
      class="mode-button"
      :class="{ 'mode-button-active': modelValue === 'sequence' }"
      type="button"
      :aria-pressed="modelValue === 'sequence'"
      @click="emit('update:modelValue', 'sequence')"
    >
      Séquences
    </button>
  </div>
</template>
