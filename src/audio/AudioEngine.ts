import { MAX_TEMPO_BPM, MIN_TEMPO_BPM } from '../tempo.ts'
import { MAX_CLICK_SKIP_PROBABILITY_PERCENT } from './clickSkipProbability.ts'
import type {
  PlaybackTimeline,
  PlaybackTimelineEvent,
} from '../music/playbackTimeline'

const SCHEDULE_AHEAD_TIME = 0.1
const SCHEDULER_INTERVAL_MS = 25
const CLICK_DURATION_SECONDS = 0.03
const MEASURE_CLICK_DURATION_SECONDS = 0.045
const CLICK_FREQUENCY_HZ = 1800
const MEASURE_CLICK_FREQUENCY_HZ = 2400
const CLICK_VOLUME = 10
const ALWAYS_PLAY_FIRST_MUSICAL_CLICKS = 5

type ScheduledClick = {
  oscillator: OscillatorNode
  gain: GainNode
}

type PulsePlayback = {
  kind: 'pulse'
  nextBeatTime: number
  lastScheduledTime: number | null
  musicalClicksScheduled: number
}

type PendingProgressEvent = {
  time: number
  event: PlaybackTimelineEvent
}

type SequencePlayback = {
  kind: 'sequence'
  timeline: PlaybackTimeline
  cycleStartTime: number
  cycleIndex: number
  eventIndex: number
  lastScheduledTime: number | null
  lastScheduledUnitOffset: number | null
  musicalClicksScheduled: number
  progressEvents: PendingProgressEvent[]
  progressIndex: number
  onProgress?: (event: PlaybackTimelineEvent) => void
  onComplete?: () => void
  onTempoChange?: (tempo: number) => void
}

type ActivePlayback = PulsePlayback | SequencePlayback
type ClickKind = 'pulse' | 'measure' | 'group'

function getAudioContextState(context: AudioContext): AudioContextState {
  return context.state
}

export class AudioEngine {
  private audioContext: AudioContext | null = null
  private schedulerTimer: ReturnType<typeof setInterval> | null = null
  private readonly scheduledClicks = new Set<ScheduledClick>()
  private contextStateListener: (() => void) | null = null
  private contextStateHandler: ((state: AudioContextState) => void) | null = null
  private resumePromise: Promise<void> | null = null
  private automaticResumeAttempted = false
  private tempo = 132
  private clickSkipProbabilityPercent = 0
  private readonly random: () => number
  private running = false
  private lifecycleToken = 0
  private startPromise: Promise<void> | null = null
  private playback: ActivePlayback | null = null

  constructor(random: () => number = Math.random) {
    this.random = random
  }

  setContextStateHandler(
    handler: ((state: AudioContextState) => void) | null,
  ): void {
    this.contextStateHandler = handler
    if (this.audioContext) {
      handler?.(this.audioContext.state)
    }
  }

  async start(tempo: number): Promise<void> {
    this.setTempo(tempo)

    if (this.running) {
      if (this.audioContext?.state !== 'running') {
        await this.resume()
      }
      return
    }

    if (this.startPromise) {
      return this.startPromise
    }

    await this.beginPlayback((startTime) => ({
      kind: 'pulse',
      nextBeatTime: startTime,
      lastScheduledTime: null,
      musicalClicksScheduled: 0,
    }))
  }

  async startSequence(
    timeline: PlaybackTimeline,
    tempo: number,
    onProgress?: (event: PlaybackTimelineEvent) => void,
    onComplete?: () => void,
    onTempoChange?: (tempo: number) => void,
  ): Promise<void> {
    if (this.running || this.startPromise) {
      throw new Error('Stop the current playback before starting a sequence.')
    }

    this.setTempo(tempo)
    await this.beginPlayback((startTime) => ({
      kind: 'sequence',
      timeline,
      cycleStartTime: startTime,
      cycleIndex: 0,
      eventIndex: 0,
      lastScheduledTime: null,
      lastScheduledUnitOffset: null,
      musicalClicksScheduled: 0,
      progressEvents: [],
      progressIndex: 0,
      onProgress,
      onComplete,
      onTempoChange,
    }))
  }

  stop(): void {
    this.lifecycleToken += 1
    this.running = false
    this.startPromise = null
    this.resumePromise = null
    this.automaticResumeAttempted = false
    this.playback = null

    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer)
      this.schedulerTimer = null
    }

    const context = this.audioContext
    if (context && context.state !== 'closed') {
      const now = context.currentTime
      for (const click of this.scheduledClicks) {
        click.oscillator.stop(now)
      }
    } else {
      this.scheduledClicks.clear()
    }
  }

  async resume(force = false): Promise<void> {
    if (this.resumePromise && !force) {
      return this.resumePromise
    }

    const pendingResume = this.resumePlayback()
    this.resumePromise = pendingResume
    try {
      await pendingResume
    } finally {
      if (this.resumePromise === pendingResume) {
        this.resumePromise = null
      }
    }
  }

  private async resumePlayback(): Promise<void> {
    const context = this.audioContext
    if (!this.running || !context || !this.playback) {
      throw new Error('There is no active playback to resume.')
    }
    if (context.state === 'closed') {
      throw new Error('The audio context is closed and must be restarted.')
    }

    const token = this.lifecycleToken
    if (context.state !== 'running') {
      await context.resume()
    }

    if (
      token !== this.lifecycleToken ||
      !this.running ||
      context !== this.audioContext
    ) {
      return
    }
    if (context.state !== 'running') {
      throw new Error('The browser did not allow audio playback to resume.')
    }

    this.schedule()
    if (this.schedulerTimer === null) {
      this.schedulerTimer = setInterval(
        () => this.schedule(),
        SCHEDULER_INTERVAL_MS,
      )
    }
  }

  setTempo(tempo: number): void {
    if (!Number.isFinite(tempo) || tempo < MIN_TEMPO_BPM || tempo > MAX_TEMPO_BPM) {
      throw new RangeError(
        `Tempo must be between ${MIN_TEMPO_BPM} and ${MAX_TEMPO_BPM} BPM.`,
      )
    }

    this.tempo = tempo

    if (!this.running || !this.audioContext || !this.playback) {
      return
    }

    if (this.playback.kind === 'pulse' && this.playback.lastScheduledTime !== null) {
      this.playback.nextBeatTime = this.playback.lastScheduledTime + this.secondsPerBeat
    } else if (
      this.playback.kind === 'sequence' &&
      this.playback.lastScheduledTime !== null &&
      this.playback.lastScheduledUnitOffset !== null
    ) {
      this.playback.cycleStartTime =
        this.playback.lastScheduledTime -
        this.playback.lastScheduledUnitOffset * this.secondsPerElementaryUnit(
          this.playback.timeline,
        )
    }
  }

  setClickSkipProbability(percent: number): void {
    if (
      !Number.isInteger(percent) ||
      percent < 0 ||
      percent > MAX_CLICK_SKIP_PROBABILITY_PERCENT
    ) {
      throw new RangeError(
        `Click skip probability must be an integer between 0 and ${MAX_CLICK_SKIP_PROBABILITY_PERCENT} percent.`,
      )
    }

    this.clickSkipProbabilityPercent = percent
  }

  private async beginPlayback(
    createPlayback: (startTime: number) => ActivePlayback,
  ): Promise<void> {
    const token = ++this.lifecycleToken
    const pendingStart = this.initializePlayback(token, createPlayback)
    this.startPromise = pendingStart

    try {
      await pendingStart
    } finally {
      if (this.startPromise === pendingStart) {
        this.startPromise = null
      }
    }
  }

  private async initializePlayback(
    token: number,
    createPlayback: (startTime: number) => ActivePlayback,
  ): Promise<void> {
    if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
      throw new Error('Web Audio API is not available in this browser.')
    }

    if (!this.audioContext || this.audioContext.state === 'closed') {
      if (this.audioContext && this.contextStateListener) {
        this.audioContext.removeEventListener(
          'statechange',
          this.contextStateListener,
        )
      }
      this.audioContext = new window.AudioContext()
      const context = this.audioContext
      this.contextStateListener = () => {
        const state = context.state
        this.contextStateHandler?.(state)

        if (state === 'running') {
          this.automaticResumeAttempted = false
          return
        }

        if (
          this.running &&
          !this.automaticResumeAttempted &&
          typeof document !== 'undefined' &&
          document.visibilityState === 'visible'
        ) {
          this.automaticResumeAttempted = true
          void this.resume().catch((error: unknown) => {
            console.info(
              'Audio did not resume automatically; use START to restart playback.',
              error,
            )
          })
        }
      }
      context.addEventListener('statechange', this.contextStateListener)
      this.contextStateHandler?.(context.state)
    }

    const context = this.audioContext
    if (context.state === 'closed') {
      throw new Error('The audio context is closed and cannot be restarted.')
    }

    let contextState = getAudioContextState(context)
    if (contextState === 'running') {
      contextState = await context
        .suspend()
        .then(() => getAudioContextState(context))

      if (token !== this.lifecycleToken || context !== this.audioContext) {
        return
      }

      if (contextState === 'running') {
        throw new Error('The browser did not allow the audio context to suspend.')
      }
      if (contextState === 'closed') {
        throw new Error('The audio context was closed while being restarted.')
      }
    }

    contextState = await context
      .resume()
      .then(() => getAudioContextState(context))

    if (token !== this.lifecycleToken) {
      return
    }

    if (contextState !== 'running') {
      throw new Error('The browser did not allow audio playback to start.')
    }

    this.running = true
    this.playback = createPlayback(context.currentTime + 0.05)

    try {
      this.schedule()
      this.schedulerTimer = setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS)
    } catch (error: unknown) {
      this.stop()
      throw error
    }
  }

  private schedule(): void {
    const context = this.audioContext
    const playback = this.playback
    if (!this.running || !context || !playback || context.state !== 'running') {
      return
    }

    const now = context.currentTime
    if (playback.kind === 'pulse') {
      this.schedulePulses(playback, now)
      return
    }

    this.scheduleSequence(playback, now)
  }

  private schedulePulses(playback: PulsePlayback, now: number): void {
    if (playback.nextBeatTime < now) {
      playback.nextBeatTime = now + 0.005
    }

    while (playback.nextBeatTime < now + SCHEDULE_AHEAD_TIME) {
      if (this.shouldPlayMusicalClick(playback.musicalClicksScheduled)) {
        this.scheduleClick(playback.nextBeatTime, 'pulse')
      }
      playback.musicalClicksScheduled += 1
      playback.lastScheduledTime = playback.nextBeatTime
      playback.nextBeatTime += this.secondsPerBeat
    }
  }

  private scheduleSequence(playback: SequencePlayback, now: number): void {
    while (true) {
      const event = playback.timeline.initialEvents[playback.eventIndex]
      if (!event) {
        const cycleEndTime =
          playback.cycleStartTime +
          playback.timeline.endUnitOffset *
            this.secondsPerElementaryUnit(playback.timeline)
        const isFinalCycle =
          playback.timeline.repeatMode === 'none' ||
          (playback.timeline.tempoProgression !== null &&
            playback.cycleIndex >= playback.timeline.tempoProgression.length - 1)
        if (isFinalCycle) {
          if (now >= cycleEndTime) {
            this.finishSequence(playback)
          }
          break
        }

        const nextCycleStartTime =
          cycleEndTime + playback.timeline.interCyclePauseSeconds
        if (nextCycleStartTime >= now + SCHEDULE_AHEAD_TIME) {
          break
        }

        playback.cycleIndex += 1
        playback.eventIndex = 0
        playback.cycleStartTime = nextCycleStartTime
        playback.lastScheduledTime = null
        playback.lastScheduledUnitOffset = null
        const progression = playback.timeline.tempoProgression
        if (progression) {
          const nextTempo = progression[playback.cycleIndex]
          if (nextTempo !== undefined) {
            this.tempo = nextTempo
            playback.onTempoChange?.(nextTempo)
          }
        }
        continue
      }

      const eventTime =
        playback.cycleStartTime +
        event.unitOffset * this.secondsPerElementaryUnit(playback.timeline)
      if (eventTime >= now + SCHEDULE_AHEAD_TIME) {
        break
      }

      if (eventTime >= now) {
        if (
          event.kind === 'count-in' ||
          this.shouldPlayMusicalClick(playback.musicalClicksScheduled)
        ) {
          this.scheduleClick(eventTime, this.clickKind(event))
        }
        if (event.kind !== 'count-in') {
          playback.musicalClicksScheduled += 1
        }
      }
      playback.progressEvents.push({
        time: Math.max(now, eventTime),
        event,
      })
      playback.lastScheduledTime = eventTime
      playback.lastScheduledUnitOffset = event.unitOffset
      playback.eventIndex += 1
    }

    this.dispatchProgress(playback, now)
  }

  private dispatchProgress(playback: SequencePlayback, now: number): void {
    while (
      playback.progressIndex < playback.progressEvents.length &&
      playback.progressEvents[playback.progressIndex]!.time <= now
    ) {
      playback.onProgress?.(
        playback.progressEvents[playback.progressIndex]!.event,
      )
      playback.progressIndex += 1
    }

    if (playback.progressIndex >= 64) {
      playback.progressEvents.splice(0, playback.progressIndex)
      playback.progressIndex = 0
    }
  }

  private finishSequence(playback: SequencePlayback): void {
    this.running = false
    this.playback = null
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer)
      this.schedulerTimer = null
    }
    playback.onComplete?.()
  }

  private clickKind(event: PlaybackTimelineEvent): ClickKind {
    if (event.kind === 'count-in') {
      return 'pulse'
    }
    return event.kind
  }

  private shouldPlayMusicalClick(clickIndex: number): boolean {
    if (
      clickIndex < ALWAYS_PLAY_FIRST_MUSICAL_CLICKS ||
      this.clickSkipProbabilityPercent === 0
    ) {
      return true
    }

    return this.random() >= this.clickSkipProbabilityPercent / 100
  }

  private scheduleClick(time: number, kind: ClickKind): void {
    const context = this.audioContext
    if (!context) {
      return
    }

    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const click = { oscillator, gain }
    const isMeasureAccent = kind === 'measure'
    const frequency = isMeasureAccent
      ? MEASURE_CLICK_FREQUENCY_HZ
      : CLICK_FREQUENCY_HZ
    const duration = isMeasureAccent
      ? MEASURE_CLICK_DURATION_SECONDS
      : CLICK_DURATION_SECONDS
    const endTime = time + duration

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, time)

    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.exponentialRampToValueAtTime(CLICK_VOLUME, time + 0.001)
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime)

    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.onended = () => {
      this.scheduledClicks.delete(click)
      oscillator.disconnect()
      gain.disconnect()
    }

    this.scheduledClicks.add(click)
    oscillator.start(time)
    oscillator.stop(endTime)
  }

  private secondsPerElementaryUnit(timeline: PlaybackTimeline): number {
    return this.secondsPerBeat / timeline.elementaryUnitsPerTempoBeat
  }

  private get secondsPerBeat(): number {
    return 60 / this.tempo
  }
}
