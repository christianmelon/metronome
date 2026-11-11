<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import {
  adjacentMechanicalTempo,
  MAX_MECHANICAL_TEMPO_BPM,
  MAX_TEMPO_BPM,
  MIN_MECHANICAL_TEMPO_BPM,
  MIN_TEMPO_BPM,
  TEMPO_HOLD_DELAY_MS,
  tempoRepeatIntervalForHold,
  tempoStepForHold,
} from '../tempo'

const props = defineProps<{
  tempo: number
  mode: 'standard' | 'mechanical'
}>()

const emit = defineEmits<{
  change: [tempo: number]
}>()

let activePointerId: number | null = null
let holdDelay: number | null = null
let repeatTimer: number | null = null
let holdStartedAt = 0
let holdTriggered = false
let suppressPointerClick = false

function adjustTempo(direction: -1 | 1, standardStep = 1): boolean {
  const nextTempo =
    props.mode === 'mechanical'
      ? adjacentMechanicalTempo(props.tempo, direction)
      : Math.min(
          MAX_TEMPO_BPM,
          Math.max(MIN_TEMPO_BPM, props.tempo + direction * standardStep),
        )
  if (nextTempo === props.tempo) {
    return false
  }

  emit('change', nextTempo)
  return true
}

function stopHold() {
  if (holdDelay !== null) {
    window.clearTimeout(holdDelay)
    holdDelay = null
  }
  if (repeatTimer !== null) {
    window.clearTimeout(repeatTimer)
    repeatTimer = null
  }
  activePointerId = null
  holdTriggered = false
}

function repeatTempo(direction: -1 | 1) {
  if (activePointerId === null) {
    return
  }

  const holdDuration = performance.now() - holdStartedAt
  const step = props.mode === 'mechanical' ? 1 : tempoStepForHold(holdDuration)
  if (!adjustTempo(direction, step)) {
    stopHold()
    return
  }

  repeatTimer = window.setTimeout(
    () => repeatTempo(direction),
    tempoRepeatIntervalForHold(holdDuration, props.mode),
  )
}

function startHold(event: PointerEvent, direction: -1 | 1) {
  if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) {
    return
  }

  stopHold()
  suppressPointerClick = false
  activePointerId = event.pointerId
  holdStartedAt = performance.now()

  holdDelay = window.setTimeout(() => {
    holdDelay = null
    if (activePointerId !== event.pointerId) {
      return
    }

    holdTriggered = true
    repeatTempo(direction)
  }, TEMPO_HOLD_DELAY_MS)
}

function endHold(event: PointerEvent) {
  if (activePointerId !== event.pointerId) {
    return
  }

  if (holdTriggered) {
    suppressPointerClick = true
  }
  stopHold()
}

function cancelHold(event: PointerEvent) {
  if (activePointerId !== event.pointerId) {
    return
  }

  if (holdTriggered) {
    suppressPointerClick = true
  }
  stopHold()
}

function handleClick(event: MouseEvent, direction: -1 | 1) {
  if (event.detail > 0 && suppressPointerClick) {
    suppressPointerClick = false
    event.preventDefault()
    return
  }

  suppressPointerClick = false
  adjustTempo(direction)
}

function stopHoldOnVisibilityChange() {
  if (document.hidden) {
    stopHold()
  }
}

onMounted(() => {
  window.addEventListener('blur', stopHold)
  document.addEventListener('visibilitychange', stopHoldOnVisibilityChange)
})

onBeforeUnmount(() => {
  stopHold()
  window.removeEventListener('blur', stopHold)
  document.removeEventListener('visibilitychange', stopHoldOnVisibilityChange)
})

watch(
  () => props.mode,
  () => {
    if (activePointerId !== null) {
      suppressPointerClick = true
    }
    stopHold()
  },
)
</script>

<template>
  <section class="tempo-control" aria-label="Réglage du tempo">
    <button
      class="tempo-step"
      type="button"
      :aria-label="
        mode === 'mechanical'
          ? 'Diminuer le tempo au palier mécanique précédent'
          : 'Diminuer le tempo de 1 BPM'
      "
      :disabled="tempo <= (mode === 'mechanical' ? MIN_MECHANICAL_TEMPO_BPM : MIN_TEMPO_BPM)"
      @pointerdown="startHold($event, -1)"
      @pointerup="endHold"
      @pointercancel="cancelHold"
      @pointerleave="cancelHold"
      @contextmenu.prevent
      @click="handleClick($event, -1)"
    >
      −
    </button>
    <div class="tempo-value" aria-live="polite" @contextmenu.prevent @selectstart.prevent>
      <span class="tempo-number">{{ tempo }}</span>
      <span class="tempo-unit">BPM</span>
    </div>
    <button
      class="tempo-step"
      type="button"
      :aria-label="
        mode === 'mechanical'
          ? 'Augmenter le tempo au palier mécanique suivant'
          : 'Augmenter le tempo de 1 BPM'
      "
      :disabled="tempo >= (mode === 'mechanical' ? MAX_MECHANICAL_TEMPO_BPM : MAX_TEMPO_BPM)"
      @pointerdown="startHold($event, 1)"
      @pointerup="endHold"
      @pointercancel="cancelHold"
      @pointerleave="cancelHold"
      @contextmenu.prevent
      @click="handleClick($event, 1)"
    >
      +
    </button>
  </section>
</template>
