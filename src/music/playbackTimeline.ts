import type { ExpandedMeasure, ParsedScore } from './score'
import { MAX_TEMPO_BPM, MIN_TEMPO_BPM } from '../tempo.ts'

export const MAX_COUNT_IN_PULSES = 32
export const INTER_CYCLE_PAUSE_SECONDS = 2

export type SequenceRepeatMode =
  | 'none'
  | 'continuous'
  | 'pause'
  | 'tempo-progression'

export interface TempoProgressionOptions {
  startTempo: number
  endTempo: number
  increment: number
}

export interface PlaybackRangeOptions {
  startMeasure: number
  endMeasure: number
  countInPulses: number
  loop?: boolean
  repeatMode?: SequenceRepeatMode
  tempoProgression?: TempoProgressionOptions
}

export interface CountInEvent {
  kind: 'count-in'
  unitOffset: number
  pulseNumber: number
  totalPulses: number
}

export interface MusicalPlaybackEvent {
  kind: 'measure' | 'group'
  unitOffset: number
  measureNumber: number
  groupNumber: number
}

export type PlaybackTimelineEvent = CountInEvent | MusicalPlaybackEvent

export interface PlaybackTimeline {
  initialEvents: PlaybackTimelineEvent[]
  loopEvents: MusicalPlaybackEvent[]
  selectedMeasures: ExpandedMeasure[]
  startMeasure: number
  endMeasure: number
  countInPulses: number
  countInUnits: number
  loopLengthUnits: number
  endUnitOffset: number
  elementaryUnitsPerTempoBeat: number
  loop: boolean
  repeatMode: SequenceRepeatMode
  interCyclePauseSeconds: number
  tempoProgression: number[] | null
}

export class PlaybackRangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlaybackRangeError'
  }
}

export function buildPlaybackTimeline(
  score: ParsedScore,
  options: PlaybackRangeOptions,
): PlaybackTimeline {
  const { startMeasure, endMeasure, countInPulses, loop } = options
  const repeatMode = options.repeatMode ?? (loop ? 'continuous' : 'none')
  const tempoProgression =
    repeatMode === 'tempo-progression'
      ? buildTempoProgression(options.tempoProgression)
      : null

  if (!Number.isInteger(startMeasure) || !Number.isInteger(endMeasure)) {
    throw new PlaybackRangeError('Measure bounds must be integers.')
  }
  if (startMeasure < 1 || endMeasure < startMeasure) {
    throw new PlaybackRangeError('The measure range must be ascending and start at measure 1 or later.')
  }
  if (!Number.isInteger(countInPulses) || countInPulses < 0 || countInPulses > MAX_COUNT_IN_PULSES) {
    throw new PlaybackRangeError(
      `The count-in must be between 0 and ${MAX_COUNT_IN_PULSES} pulses.`,
    )
  }

  const startIndex = score.measures.findIndex((measure) => measure.number === startMeasure)
  const endIndex = score.measures.findIndex((measure) => measure.number === endMeasure)
  if (startIndex < 0 || endIndex < 0) {
    throw new PlaybackRangeError('The selected measure range is outside the loaded score.')
  }

  const selectedMeasures = score.measures.slice(startIndex, endIndex + 1)
  const firstMeasure = selectedMeasures[0]
  const lastMeasure = selectedMeasures[selectedMeasures.length - 1]
  if (!firstMeasure || !lastMeasure) {
    throw new PlaybackRangeError('The selected measure range is empty.')
  }

  const loopLengthUnits = selectedMeasures.reduce(
    (total, measure) => total + measure.groups.reduce((sum, group) => sum + group, 0),
    0,
  )
  const elementaryUnitsPerTempoBeat = score.tempoUnit.elementaryUnitsPerTempoBeat
  const countInUnits = countInPulses * elementaryUnitsPerTempoBeat
  const selectedMusicalEvents: MusicalPlaybackEvent[] = score.events
    .filter(
      (event) =>
        event.startsGroup &&
        event.measureNumber >= startMeasure &&
        event.measureNumber <= endMeasure,
    )
    .map((event) => ({
      kind: event.groupNumber === 1 ? 'measure' : 'group',
      unitOffset: event.absoluteUnitOffset - firstMeasure.absoluteUnitOffset,
      measureNumber: event.measureNumber,
      groupNumber: event.groupNumber,
    }))

  const countInEvents: CountInEvent[] = Array.from(
    { length: countInPulses },
    (_, index) => ({
      kind: 'count-in',
      unitOffset: index * elementaryUnitsPerTempoBeat,
      pulseNumber: index + 1,
      totalPulses: countInPulses,
    }),
  )
  const initialEvents: PlaybackTimelineEvent[] = [
    ...countInEvents,
    ...selectedMusicalEvents.map((event) => ({
      ...event,
      unitOffset: event.unitOffset + countInUnits,
    })),
  ].sort((left, right) => left.unitOffset - right.unitOffset)

  return {
    initialEvents,
    loopEvents: selectedMusicalEvents,
    selectedMeasures,
    startMeasure,
    endMeasure,
    countInPulses,
    countInUnits,
    loopLengthUnits,
    endUnitOffset: countInUnits + loopLengthUnits,
    elementaryUnitsPerTempoBeat,
    loop: repeatMode !== 'none',
    repeatMode,
    interCyclePauseSeconds:
      repeatMode === 'pause' || repeatMode === 'tempo-progression'
        ? INTER_CYCLE_PAUSE_SECONDS
        : 0,
    tempoProgression,
  }
}

export function buildTempoProgression(
  options: TempoProgressionOptions | undefined,
): number[] {
  if (!options) {
    throw new PlaybackRangeError('Tempo progression settings are required.')
  }

  const { startTempo, endTempo, increment } = options
  if (
    !Number.isSafeInteger(startTempo) ||
    startTempo < MIN_TEMPO_BPM ||
    startTempo > MAX_TEMPO_BPM ||
    !Number.isSafeInteger(endTempo) ||
    endTempo < MIN_TEMPO_BPM ||
    endTempo > MAX_TEMPO_BPM ||
    !Number.isSafeInteger(increment) ||
    increment < 1 ||
    increment > MAX_TEMPO_BPM - MIN_TEMPO_BPM
  ) {
    throw new PlaybackRangeError(
      `Tempo progression must use integer tempos between ${MIN_TEMPO_BPM} and ${MAX_TEMPO_BPM} BPM and a positive integer increment.`,
    )
  }

  if (startTempo === endTempo) {
    return [startTempo]
  }

  const direction = endTempo > startTempo ? 1 : -1
  const progression: number[] = []
  for (let tempo = startTempo; ; tempo += direction * increment) {
    if (
      (direction > 0 && tempo >= endTempo) ||
      (direction < 0 && tempo <= endTempo)
    ) {
      progression.push(endTempo)
      break
    }
    progression.push(tempo)
  }

  return progression
}
