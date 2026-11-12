<script setup lang="ts">
import { MAX_COUNT_IN_PULSES } from '../music/playbackTimeline'
import type { SequenceRepeatMode } from '../music/playbackTimeline'
import type { SequenceCatalogEntry } from '../music/sequenceCatalog'
import { MAX_TEMPO_BPM, MIN_TEMPO_BPM } from '../tempo'

defineProps<{
  catalog: readonly SequenceCatalogEntry[]
  selectedSequenceId: string
  minimumMeasure: number
  maximumMeasure: number
  startMeasure: number
  endMeasure: number
  countInPulses: number
  repeatMode: SequenceRepeatMode
  progressionStartTempo: number
  progressionEndTempo: number
  progressionIncrement: number
  disabled: boolean
}>()

const emit = defineEmits<{
  sequenceSelected: [id: string]
  'update:startMeasure': [measure: number]
  'update:endMeasure': [measure: number]
  'update:countInPulses': [pulses: number]
  'update:repeatMode': [mode: SequenceRepeatMode]
  'update:progressionStartTempo': [tempo: number]
  'update:progressionEndTempo': [tempo: number]
  'update:progressionIncrement': [increment: number]
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

function updateRepeatMode(event: Event) {
  const input = event.currentTarget
  if (!(input instanceof HTMLSelectElement)) {
    return
  }

  switch (input.value) {
    case 'none':
    case 'continuous':
    case 'pause':
    case 'tempo-progression':
      emit('update:repeatMode', input.value)
  }
}

function updateProgressionValue(
  event: Event,
  emitUpdate: (value: number) => void,
) {
  const value = readNumber(event)
  if (value !== null) {
    emitUpdate(value)
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
          {{ sequence.title }}
        </option>
      </select>
    </label>

    <div class="playback-options">
      <label class="number-field">
        <span class="field-label">Mesure de début</span>
        <input
          type="number"
          :min="minimumMeasure"
          :max="maximumMeasure"
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
          :min="minimumMeasure"
          :max="maximumMeasure"
          step="1"
          :value="endMeasure"
          :disabled="disabled"
          @input="updateEndMeasure"
        />
      </label>
      <label class="number-field">
        <span class="field-label">Décompte (pulses / cycle)</span>
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
      <label class="number-field">
        <span class="field-label">Répétition</span>
        <select
          class="sequence-select"
          :value="repeatMode"
          :disabled="disabled"
          @change="updateRepeatMode"
        >
          <option value="none">Aucune</option>
          <option value="continuous">Boucle continue</option>
          <option value="pause">Boucle — pause 2 s</option>
          <option value="tempo-progression">Progression de tempo</option>
        </select>
      </label>
    </div>
    <div v-if="repeatMode === 'tempo-progression'" class="playback-options">
      <label class="number-field">
        <span class="field-label">Départ (BPM)</span>
        <input
          type="number"
          :min="MIN_TEMPO_BPM"
          :max="MAX_TEMPO_BPM"
          step="1"
          :value="progressionStartTempo"
          :disabled="disabled"
          @input="updateProgressionValue($event, (value) => emit('update:progressionStartTempo', value))"
        />
      </label>
      <label class="number-field">
        <span class="field-label">Fin (BPM)</span>
        <input
          type="number"
          :min="MIN_TEMPO_BPM"
          :max="MAX_TEMPO_BPM"
          step="1"
          :value="progressionEndTempo"
          :disabled="disabled"
          @input="updateProgressionValue($event, (value) => emit('update:progressionEndTempo', value))"
        />
      </label>
      <label class="number-field">
        <span class="field-label">Pas (BPM)</span>
        <input
          type="number"
          min="1"
          :max="MAX_TEMPO_BPM - MIN_TEMPO_BPM"
          step="1"
          :value="progressionIncrement"
          :disabled="disabled"
          @input="updateProgressionValue($event, (value) => emit('update:progressionIncrement', value))"
        />
      </label>
    </div>
  </section>
</template>
