<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { AudioEngine } from './audio/AudioEngine'
import ModeSelector from './components/ModeSelector.vue'
import SequenceControls from './components/SequenceControls.vue'
import TempoControl from './components/TempoControl.vue'
import Transport from './components/Transport.vue'
import {
  buildPlaybackTimeline,
  MAX_COUNT_IN_PULSES,
  type PlaybackTimelineEvent,
} from './music/playbackTimeline'
import {
  SEQUENCE_CATALOG,
  type SequenceCatalogEntry,
} from './music/sequenceCatalog'
import type { ParsedScore } from './music/score'
import { registerOfflineSupport } from './offline/registerOfflineSupport'
import { nearestMechanicalTempo } from './tempo'

type PlaybackMode = 'pulse' | 'sequence'
type TempoAdjustmentMode = 'standard' | 'mechanical'
type OfflineStatus = 'hidden' | 'preparing' | 'ready' | 'unavailable'

const defaultSequence = SEQUENCE_CATALOG[0]
if (!defaultSequence) {
  throw new Error('The sequence catalog must contain at least one score.')
}

const audioEngine = new AudioEngine()
const mode = ref<PlaybackMode>('pulse')
const tempoAdjustmentMode = ref<TempoAdjustmentMode>('standard')
const tempo = ref(132)
const score = shallowRef<ParsedScore | null>(defaultSequence.score)
const selectedSequenceId = ref(defaultSequence.id)
const startMeasure = ref(1)
const endMeasure = ref(defaultSequence.score.measures.length)
const countInPulses = ref(4)
const loop = ref(false)
const isRunning = ref(false)
const isStarting = ref(false)
const isInterrupted = ref(false)
const isCompleted = ref(false)
const errorMessage = ref('')
const currentMeasure = ref<number | null>(null)
const currentGroup = ref<number | null>(null)
const countInProgress = ref<{ pulseNumber: number; totalPulses: number } | null>(null)
const offlineStatus = ref<OfflineStatus>('hidden')
let transportRequest = 0
let resumeOnForeground = false

audioEngine.setContextStateHandler((state) => {
  if (state !== 'running' && (isRunning.value || isStarting.value)) {
    isInterrupted.value = true
  }
})

const measureCount = computed(() => score.value?.measures.length ?? 0)
const canStart = computed(() => {
  if (mode.value === 'pulse') {
    return true
  }

  const parsedScore = score.value
  return (
    parsedScore !== null &&
    Number.isInteger(startMeasure.value) &&
    Number.isInteger(endMeasure.value) &&
    startMeasure.value >= 1 &&
    endMeasure.value >= startMeasure.value &&
    endMeasure.value <= parsedScore.measures.length &&
    Number.isInteger(countInPulses.value) &&
    countInPulses.value >= 0 &&
    countInPulses.value <= MAX_COUNT_IN_PULSES
  )
})
const currentMeasureInfo = computed(() => {
  if (!score.value || currentMeasure.value === null) {
    return null
  }
  return score.value.measures.find((measure) => measure.number === currentMeasure.value) ?? null
})

function updateTempo(nextTempo: number) {
  tempo.value = nextTempo
  audioEngine.setTempo(nextTempo)
}

function toggleTempoAdjustmentMode() {
  const nextMode =
    tempoAdjustmentMode.value === 'standard' ? 'mechanical' : 'standard'
  if (nextMode === 'mechanical') {
    updateTempo(nearestMechanicalTempo(tempo.value))
  }
  tempoAdjustmentMode.value = nextMode
}

function clearPlaybackStatus() {
  isCompleted.value = false
  currentMeasure.value = null
  currentGroup.value = null
  countInProgress.value = null
}

function setMode(nextMode: PlaybackMode) {
  if (nextMode === mode.value) {
    return
  }

  if (isRunning.value || isStarting.value) {
    stop()
  }

  mode.value = nextMode
  errorMessage.value = ''
  clearPlaybackStatus()
}

function selectSequence(id: string) {
  const selected = SEQUENCE_CATALOG.find(
    (entry: SequenceCatalogEntry) => entry.id === id,
  )
  if (!selected) {
    errorMessage.value = 'Cette séquence prédéfinie est introuvable.'
    return
  }

  if (isRunning.value || isStarting.value) {
    stop()
  }

  selectedSequenceId.value = selected.id
  score.value = selected.score
  startMeasure.value = 1
  endMeasure.value = selected.score.measures.length
  countInPulses.value = 4
  loop.value = false
  updateTempo(
    tempoAdjustmentMode.value === 'mechanical'
      ? nearestMechanicalTempo(selected.score.tempo)
      : selected.score.tempo,
  )
  errorMessage.value = ''
  clearPlaybackStatus()
}

function handlePlaybackProgress(event: PlaybackTimelineEvent, request: number) {
  if (request !== transportRequest) {
    return
  }

  isCompleted.value = false
  if (event.kind === 'count-in') {
    countInProgress.value = {
      pulseNumber: event.pulseNumber,
      totalPulses: event.totalPulses,
    }
    currentMeasure.value = null
    currentGroup.value = null
    return
  }

  countInProgress.value = null
  currentMeasure.value = event.measureNumber
  currentGroup.value = event.groupNumber
}

async function start() {
  const parsedScore = score.value
  if (mode.value === 'sequence' && (!parsedScore || !canStart.value)) {
    errorMessage.value = 'Sélectionne une séquence et une plage de mesures valide.'
    return
  }

  const request = ++transportRequest
  isStarting.value = true
  errorMessage.value = ''

  try {
    if (isInterrupted.value && isRunning.value) {
      try {
        await audioEngine.resume()
        if (request === transportRequest) {
          isInterrupted.value = false
          isStarting.value = false
        }
        return
      } catch {
        if (request !== transportRequest) {
          return
        }
        audioEngine.stop()
        isRunning.value = false
        isInterrupted.value = false
      }
    }

    clearPlaybackStatus()
    if (mode.value === 'pulse') {
      await audioEngine.start(tempo.value)
    } else if (parsedScore) {
      const timeline = buildPlaybackTimeline(parsedScore, {
        startMeasure: startMeasure.value,
        endMeasure: endMeasure.value,
        countInPulses: countInPulses.value,
        loop: loop.value,
      })

      await audioEngine.startSequence(
        timeline,
        tempo.value,
        (event) => handlePlaybackProgress(event, request),
        () => {
          if (request === transportRequest) {
            isRunning.value = false
            isInterrupted.value = false
            isCompleted.value = true
          }
        },
      )
    }

    if (request === transportRequest) {
      isRunning.value = true
      isInterrupted.value = false
    }
  } catch (error: unknown) {
    if (request === transportRequest) {
      isRunning.value = false
      isInterrupted.value = false
      errorMessage.value =
        error instanceof Error ? error.message : 'Impossible de démarrer la lecture audio.'
    }
  } finally {
    if (request === transportRequest) {
      isStarting.value = false
    }
  }
}

function stop() {
  transportRequest += 1
  resumeOnForeground = false
  audioEngine.stop()
  isRunning.value = false
  isStarting.value = false
  isInterrupted.value = false
  clearPlaybackStatus()
}

function markBackgrounded() {
  if (isRunning.value || isStarting.value) {
    resumeOnForeground = true
  }
}

function handleForeground() {
  if (
    document.visibilityState === 'visible' &&
    resumeOnForeground &&
    (isRunning.value || isStarting.value)
  ) {
    resumeOnForeground = false
    isInterrupted.value = true
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    markBackgrounded()
    return
  }
  handleForeground()
}

function initializeOfflineSupport() {
  if (!import.meta.env.PROD) {
    return
  }

  offlineStatus.value = 'preparing'
  registerOfflineSupport()
    .then(() => {
      offlineStatus.value = 'ready'
    })
    .catch((error: unknown) => {
      console.error('Offline support could not be enabled.', error)
      offlineStatus.value = 'unavailable'
    })
}

onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('blur', markBackgrounded)
  window.addEventListener('focus', handleForeground)
  window.addEventListener('pageshow', handleForeground)
  initializeOfflineSupport()
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('blur', markBackgrounded)
  window.removeEventListener('focus', handleForeground)
  window.removeEventListener('pageshow', handleForeground)
  audioEngine.setContextStateHandler(null)
  audioEngine.stop()
})
</script>

<template>
  <main class="metronome">
    <header class="app-header">
      <p class="eyebrow">PULSE AUDIO</p>
      <h1>Métronome</h1>
    </header>

    <ModeSelector :model-value="mode" @update:model-value="setMode" />

    <SequenceControls
      v-if="mode === 'sequence'"
      :catalog="SEQUENCE_CATALOG"
      :selected-sequence-id="selectedSequenceId"
      :measure-count="measureCount"
      :start-measure="startMeasure"
      :end-measure="endMeasure"
      :count-in-pulses="countInPulses"
      :loop="loop"
      :disabled="isRunning || isStarting"
      @sequence-selected="selectSequence"
      @update:start-measure="startMeasure = $event"
      @update:end-measure="endMeasure = $event"
      @update:count-in-pulses="countInPulses = $event"
      @update:loop="loop = $event"
    />

    <TempoControl
      :tempo="tempo"
      :mode="tempoAdjustmentMode"
      @change="updateTempo"
    />
    <Transport
      :can-start="canStart"
      :is-running="isRunning"
      :is-starting="isStarting"
      :is-interrupted="isInterrupted"
      @start="start"
      @stop="stop"
    />

    <p v-if="errorMessage" class="error-message" role="alert">
      {{ errorMessage }}
    </p>
    <p class="playback-status" aria-live="polite">
      <template v-if="isInterrupted">
        Audio interrompu — touchez REPRENDRE pour reprendre
      </template>
      <template v-else-if="mode === 'sequence' && countInProgress">
        Décompte : pulse {{ countInProgress.pulseNumber }} / {{ countInProgress.totalPulses }}
      </template>
      <template v-else-if="mode === 'sequence' && currentMeasureInfo">
        Mesure {{ currentMeasureInfo.number }} — {{ currentMeasureInfo.meter.notation }}
        <span v-if="currentGroup"> · Groupe {{ currentGroup }}</span>
        <span> · Groupes {{ currentMeasureInfo.groups.join(' + ') }}</span>
      </template>
      <template v-else-if="isStarting">Préparation…</template>
      <template v-else-if="isRunning">
        {{ mode === 'pulse' ? 'Pulse régulière en cours' : 'Séquence en lecture' }}
      </template>
      <template v-else-if="isCompleted">Lecture terminée</template>
      <template v-else-if="mode === 'pulse'">Prêt à jouer la pulse</template>
      <template v-else>Séquence prête</template>
    </p>

    <p v-if="offlineStatus !== 'hidden'" class="offline-status" aria-live="polite">
      <template v-if="offlineStatus === 'preparing'">Préparation du mode hors ligne…</template>
      <template v-else-if="offlineStatus === 'ready'">Application prête hors ligne</template>
      <template v-else>
        Mode hors ligne indisponible sur cette adresse ou ce navigateur.
      </template>
    </p>

    <footer class="app-footer">
      <button
        class="tempo-mode-toggle"
        type="button"
        :aria-pressed="tempoAdjustmentMode === 'mechanical'"
        aria-label="Basculer le mode de réglage du tempo"
        @click="toggleTempoAdjustmentMode"
      >
        Mode tempo : {{ tempoAdjustmentMode === 'mechanical' ? 'Mécanique' : 'Standard' }}
      </button>
    </footer>
  </main>
</template>
