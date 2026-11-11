<script setup lang="ts">
defineProps<{
  canStart: boolean
  isRunning: boolean
  isStarting: boolean
  isInterrupted: boolean
}>()

defineEmits<{
  start: []
  stop: []
}>()
</script>

<template>
  <div class="transport">
    <button
      class="transport-button start-button"
      type="button"
      :disabled="!canStart || (isRunning && !isInterrupted) || isStarting"
      @click="$emit('start')"
    >
      {{ isStarting ? 'DÉMARRAGE…' : isInterrupted ? 'REPRENDRE' : 'START' }}
    </button>
    <button
      class="transport-button stop-button"
      type="button"
      :disabled="!isRunning && !isStarting"
      @click="$emit('stop')"
    >
      STOP
    </button>
  </div>
</template>
