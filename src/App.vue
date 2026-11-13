<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { nextClickSkipProbability } from './audio/clickSkipProbability'
import { AudioEngine } from './audio/AudioEngine'
import { requestAutomaticAudioSession } from './audio/audioSession'
import {
  isMobileDevice as detectMobileDevice,
  ScreenWakeLockController,
  type ScreenWakeLockState,
} from './screenWakeLock'
import ModeSelector from './components/ModeSelector.vue'
import SequenceControls from './components/SequenceControls.vue'
import TempoControl from './components/TempoControl.vue'
import Transport from './components/Transport.vue'
import {
  buildPlaybackTimeline,
  MAX_COUNT_IN_PULSES,
  type SequenceRepeatMode,
  type PlaybackTimelineEvent,
} from './music/playbackTimeline'
import {
  SEQUENCE_CATALOG,
  type SequenceCatalogEntry,
} from './music/sequenceCatalog'
import type { ParsedScore } from './music/score'
import { registerOfflineSupport } from './offline/registerOfflineSupport'
import {
  MAX_TEMPO_BPM,
  MIN_TEMPO_BPM,
  nearestMechanicalTempo,
} from './tempo'

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
const clickSkipProbability = ref(0)
const score = shallowRef<ParsedScore | null>(defaultSequence.score)
const selectedSequenceId = ref(defaultSequence.id)
const defaultStartMeasure = defaultSequence.score.measures[0]?.number ?? 1
const defaultMeasures = defaultSequence.score.measures
const defaultEndMeasure =
  defaultMeasures[defaultMeasures.length - 1]?.number ?? defaultStartMeasure
const startMeasure = ref(defaultStartMeasure)
const endMeasure = ref(defaultEndMeasure)
const countInPulses = ref(4)
const repeatMode = ref<SequenceRepeatMode>('none')
const progressionStartTempo = ref(defaultSequence.score.tempo)
const progressionEndTempo = ref(defaultSequence.score.tempo)
const progressionIncrement = ref(5)
const isRunning = ref(false)
const isStarting = ref(false)
const isInterrupted = ref(false)
const canRestartAfterForeground = ref(false)
const audioContextState = ref<AudioContextState | 'unknown'>('unknown')
const isCompleted = ref(false)
const errorMessage = ref('')
const currentMeasure = ref<number | null>(null)
const currentGroup = ref<number | null>(null)
const countInProgress = ref<{ pulseNumber: number; totalPulses: number } | null>(null)
const offlineStatus = ref<OfflineStatus>('hidden')
const screenWakeLockState = ref<ScreenWakeLockState>('idle')
const buildId = __APP_BUILD_ID__
let transportRequest = 0
let resumeOnForeground = false
const isMobile = detectMobileDevice(
  typeof navigator === 'undefined' ? undefined : navigator,
  typeof window === 'undefined' ? undefined : window.matchMedia.bind(window),
)
const screenWakeLock = new ScreenWakeLockController(
  typeof navigator === 'undefined' ? undefined : navigator,
  (state) => {
    screenWakeLockState.value = state
  },
)
const screenWakeLockSupported = screenWakeLock.supported
if (!screenWakeLockSupported) {
  screenWakeLockState.value = 'unsupported'
}

audioEngine.setContextStateHandler((state) => {
  audioContextState.value = state
  if (state === 'running' && isRunning.value) {
    isInterrupted.value = false
  } else if (state !== 'running' && (isRunning.value || isStarting.value)) {
    isInterrupted.value = true
  }
})

const firstMeasureNumber = computed(() => score.value?.measures[0]?.number ?? 1)
const isTempoLocked = computed(
  () =>
    (isRunning.value || isStarting.value) &&
    repeatMode.value === 'tempo-progression',
)
const lastMeasureNumber = computed(() => {
  const measures = score.value?.measures
  return measures?.[measures.length - 1]?.number ?? 0
})
const canStart = computed(() => {
  if (mode.value === 'pulse') {
    return true
  }

  const parsedScore = score.value
  return (
    parsedScore !== null &&
    Number.isInteger(startMeasure.value) &&
    Number.isInteger(endMeasure.value) &&
    startMeasure.value >= firstMeasureNumber.value &&
    endMeasure.value >= startMeasure.value &&
    endMeasure.value <= lastMeasureNumber.value &&
    Number.isInteger(countInPulses.value) &&
    countInPulses.value >= 0 &&
    countInPulses.value <= MAX_COUNT_IN_PULSES &&
    (repeatMode.value !== 'tempo-progression' ||
      (Number.isSafeInteger(progressionStartTempo.value) &&
        progressionStartTempo.value >= MIN_TEMPO_BPM &&
        progressionStartTempo.value <= MAX_TEMPO_BPM &&
        Number.isSafeInteger(progressionEndTempo.value) &&
        progressionEndTempo.value >= MIN_TEMPO_BPM &&
        progressionEndTempo.value <= MAX_TEMPO_BPM &&
        Number.isSafeInteger(progressionIncrement.value) &&
        progressionIncrement.value > 0 &&
        progressionIncrement.value <= MAX_TEMPO_BPM - MIN_TEMPO_BPM))
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

function cycleClickSkipProbability() {
  const nextProbability = nextClickSkipProbability(clickSkipProbability.value)
  audioEngine.setClickSkipProbability(nextProbability)
  clickSkipProbability.value = nextProbability
}

function updateRepeatMode(nextMode: SequenceRepeatMode) {
  if (nextMode === 'tempo-progression') {
    progressionStartTempo.value = tempo.value
    progressionEndTempo.value = tempo.value
  }
  repeatMode.value = nextMode
}

const screenWakeLockMessage = computed(() => {
  switch (screenWakeLockState.value) {
    case 'requesting':
      return 'Demande de maintien de l’écran…'
    case 'active':
      return 'L’écran reste allumé pendant la lecture.'
    case 'released':
      return 'Le navigateur a libéré le maintien de l’écran.'
    case 'unsupported':
      return 'Wake Lock indisponible ici (navigateur ou contexte non sécurisé); le métronome continue.'
    case 'failed':
      return 'Impossible de maintenir l’écran allumé; le métronome continue.'
    case 'idle':
      return 'Le maintien s’activera pendant la lecture.'
  }
})

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
  startMeasure.value = selected.score.measures[0]?.number ?? 1
  const selectedMeasures = selected.score.measures
  endMeasure.value =
    selectedMeasures[selectedMeasures.length - 1]?.number ?? startMeasure.value
  countInPulses.value = 4
  repeatMode.value = 'none'
  updateTempo(
    tempoAdjustmentMode.value === 'mechanical'
      ? nearestMechanicalTempo(selected.score.tempo)
      : selected.score.tempo,
  )
  progressionStartTempo.value = tempo.value
  progressionEndTempo.value = tempo.value
  progressionIncrement.value = 5
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

  requestAutomaticAudioSession(navigator)

  const request = ++transportRequest
  isStarting.value = true
  errorMessage.value = ''
  if (isMobile) {
    void screenWakeLock.request()
  }

  try {
    if (
      isRunning.value &&
      (isInterrupted.value || canRestartAfterForeground.value)
    ) {
      audioEngine.stop()
      isRunning.value = false
      isInterrupted.value = false
    }
    resumeOnForeground = false
    canRestartAfterForeground.value = false

    clearPlaybackStatus()
    if (mode.value === 'pulse') {
      await audioEngine.start(tempo.value)
    } else if (parsedScore) {
      const progressionSettings =
        repeatMode.value === 'tempo-progression'
          ? {
              startTempo: progressionStartTempo.value,
              endTempo: progressionEndTempo.value,
              increment: progressionIncrement.value,
            }
          : undefined
      if (progressionSettings) {
        updateTempo(progressionSettings.startTempo)
      }
      const timeline = buildPlaybackTimeline(parsedScore, {
        startMeasure: startMeasure.value,
        endMeasure: endMeasure.value,
        countInPulses: countInPulses.value,
        repeatMode: repeatMode.value,
        tempoProgression: progressionSettings,
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
            void screenWakeLock.release()
          }
        },
        (nextTempo) => {
          if (request === transportRequest) {
            tempo.value = nextTempo
          }
        },
      )
    }

    if (request === transportRequest) {
      isRunning.value = true
      isInterrupted.value = false
      canRestartAfterForeground.value = false
    }
  } catch (error: unknown) {
    if (request === transportRequest) {
      isRunning.value = false
      isInterrupted.value = false
      canRestartAfterForeground.value = false
      void screenWakeLock.release()
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
  void screenWakeLock.release()
  isRunning.value = false
  isStarting.value = false
  isInterrupted.value = false
  canRestartAfterForeground.value = false
  clearPlaybackStatus()
}

function markBackgrounded() {
  if (isRunning.value || isStarting.value) {
    resumeOnForeground = true
  }
}

function handleForeground() {
  if (document.visibilityState !== 'visible') {
    return
  }

  if (isMobile && (isRunning.value || isStarting.value)) {
    void screenWakeLock.request()
  }

  if (!resumeOnForeground) {
    return
  }

  resumeOnForeground = false
  if (!isRunning.value && !isStarting.value) {
    return
  }

  canRestartAfterForeground.value = true
  isInterrupted.value = true
  const request = transportRequest
  void audioEngine.resume(true).then(
    () => {
      if (request === transportRequest && isRunning.value) {
        isInterrupted.value = false
        errorMessage.value = ''
      }
    },
    (error: unknown) => {
      if (request === transportRequest && isRunning.value) {
        isInterrupted.value = true
        console.info(
          'Audio did not resume automatically; use START to restart playback.',
          error,
        )
      }
    },
  )
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
  window.addEventListener('pagehide', markBackgrounded)
  window.addEventListener('focus', handleForeground)
  window.addEventListener('pageshow', handleForeground)
  initializeOfflineSupport()
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('blur', markBackgrounded)
  window.removeEventListener('pagehide', markBackgrounded)
  window.removeEventListener('focus', handleForeground)
  window.removeEventListener('pageshow', handleForeground)
  audioEngine.setContextStateHandler(null)
  audioEngine.stop()
  void screenWakeLock.release()
})
</script>

<template>
  <main
    class="metronome"
    :data-build-id="buildId"
    :data-audio-state="audioContextState"
    data-audio-session-request="auto"
  >
    <header class="app-header">
      <p class="eyebrow">PULSE AUDIO</p>
      <h1>Métronome</h1>
    </header>

    <ModeSelector :model-value="mode" @update:model-value="setMode" />

    <SequenceControls
      v-if="mode === 'sequence'"
      :catalog="SEQUENCE_CATALOG"
      :selected-sequence-id="selectedSequenceId"
      :minimum-measure="firstMeasureNumber"
      :maximum-measure="lastMeasureNumber"
      :start-measure="startMeasure"
      :end-measure="endMeasure"
      :count-in-pulses="countInPulses"
      :repeat-mode="repeatMode"
      :progression-start-tempo="progressionStartTempo"
      :progression-end-tempo="progressionEndTempo"
      :progression-increment="progressionIncrement"
      :disabled="isRunning || isStarting"
      @sequence-selected="selectSequence"
      @update:start-measure="startMeasure = $event"
      @update:end-measure="endMeasure = $event"
      @update:count-in-pulses="countInPulses = $event"
      @update:repeat-mode="updateRepeatMode"
      @update:progression-start-tempo="progressionStartTempo = $event"
      @update:progression-end-tempo="progressionEndTempo = $event"
      @update:progression-increment="progressionIncrement = $event"
    />

    <TempoControl
      :tempo="tempo"
      :mode="tempoAdjustmentMode"
      :disabled="isTempoLocked"
      @change="updateTempo"
    />
    <button
      class="tempo-mode-toggle random-probability-toggle"
      type="button"
      :aria-pressed="clickSkipProbability > 0"
      aria-label="Modifier la probabilité d’omission aléatoire des clics"
      @click="cycleClickSkipProbability"
    >
      Aléatoire : {{ clickSkipProbability === 0 ? 'désactivé' : `${clickSkipProbability} %` }}
    </button>
    <Transport
      :can-start="canStart"
      :is-running="isRunning"
      :is-starting="isStarting"
      :can-restart="isInterrupted || canRestartAfterForeground"
      @start="start"
      @stop="stop"
    />

    <p
      v-if="
        isMobile &&
        (!screenWakeLockSupported ||
          isRunning ||
          isStarting ||
          screenWakeLockState === 'failed')
      "
      class="wake-lock-status"
      aria-live="polite"
    >
      {{ screenWakeLockMessage }}
    </p>

    <p v-if="errorMessage" class="error-message" role="alert">
      {{ errorMessage }}
    </p>
    <p class="playback-status" aria-live="polite">
      <template v-if="isInterrupted">
        Audio interrompu ({{ audioContextState }}) — touchez START pour redémarrer
      </template>
      <template v-else-if="canRestartAfterForeground">
        Retour au premier plan — si aucun son, touchez START pour redémarrer
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

    <p class="audio-context-status" aria-live="polite">
      État AudioContext : <code>{{ audioContextState }}</code>
      <span v-if="audioContextState === 'unknown'"> — pas encore créé</span>
      <span v-else-if="audioContextState === 'running'">
        — actif, sans garantie que le son soit audible
      </span>
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
        :disabled="isTempoLocked"
        :aria-pressed="tempoAdjustmentMode === 'mechanical'"
        aria-label="Basculer le mode de réglage du tempo"
        @click="toggleTempoAdjustmentMode"
      >
        Mode tempo : {{ tempoAdjustmentMode === 'mechanical' ? 'Mécanique' : 'Standard' }}
      </button>
    </footer>
  </main>
</template>
