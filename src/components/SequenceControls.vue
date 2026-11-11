<script setup lang="ts">
import { MAX_COUNT_IN_PULSES } from '../music/playbackTimeline'
import type { SequenceCatalogEntry } from '../music/sequenceCatalog'

defineProps<{
  catalog: readonly SequenceCatalogEntry[]
  selectedSequenceId: string
  measureCount: number
  startMeasure: number
  endMeasure: number
  countInPulses: number
  loop: boolean
  disabled: boolean
}>()

const emit = defineEmits<{
  sequenceSelected: [id: string]
  'update:startMeasure': [measure: number]
  'update:endMeasure': [measure: number]
  'update:countInPulses': [pulses: number]
  'update:loop': [loop: boolean]
}>()

function readNumber(event: Event): number | null {
  const input = event.currentTarget
  if (!(input instanceof HTMLInputElement) || input.value.trim() === '') {
    return null
  }

  const value = Number(input.value)
  return Number.isFinite(value) ? value : null
}

function updateStartMeasure(event: Event) {
  const value = readNumber(event)
  if (value !== null) {
    emit('update:startMeasure', value)
  }
}

function updateEndMeasure(event: Event) {
  const value = readNumber(event)
  if (value !== null) {
    emit('update:endMeasure', value)
  }
}

function updateCountIn(event: Event) {
  const value = readNumber(event)
  if (value !== null) {
    emit(
      'update:countInPulses',
      Math.min(MAX_COUNT_IN_PULSES, Math.max(0, Math.trunc(value))),
    )
  }
}

function updateLoop(event: Event) {
  const input = event.currentTarget
  if (input instanceof HTMLInputElement) {
    emit('update:loop', input.checked)
  }
}

function selectSequence(event: Event) {
  const input = event.currentTarget
  if (input instanceof HTMLSelectElement) {
    emit('sequenceSelected', input.value)
  }
}
</script>

<template>
  <section class="score-controls" aria-label="Configuration de la séquence">
    <label class="sequence-picker">
      <span class="field-label">Séquence prédéfinie</span>
      <select
        class="sequence-select"
        :value="selectedSequenceId"
        :disabled="disabled"
        @change="selectSequence"
      >
        <option v-for="sequence in catalog" :key="sequence.id" :value="sequence.id">
          {{ sequence.title }} — {{ sequence.description }}
        </option>
      </select>
    </label>

    <div class="playback-options">
      <label class="number-field">
        <span class="field-label">Mesure de début</span>
        <input
          type="number"
          min="1"
          :max="measureCount"
          step="1"
          :value="startMeasure"
          :disabled="disabled"
          @input="updateStartMeasure"
        />
      </label>
      <label class="number-field">
        <span class="field-label">Mesure de fin</span>
        <input
          type="number"
          min="1"
          :max="measureCount"
          step="1"
          :value="endMeasure"
          :disabled="disabled"
          @input="updateEndMeasure"
        />
      </label>
      <label class="number-field">
        <span class="field-label">Décompte (pulses)</span>
        <input
          type="number"
          min="0"
          :max="MAX_COUNT_IN_PULSES"
          step="1"
          :value="countInPulses"
          :disabled="disabled"
          @input="updateCountIn"
        />
      </label>
      <label class="loop-field">
        <input
          type="checkbox"
          :checked="loop"
          :disabled="disabled"
          @change="updateLoop"
        />
        <span>Boucle</span>
      </label>
    </div>
  </section>
</template>
