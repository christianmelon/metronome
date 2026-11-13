import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { AudioEngine } from '../src/audio/AudioEngine.ts'
import { requestAutomaticAudioSession } from '../src/audio/audioSession.ts'
import { buildPlaybackTimeline } from '../src/music/playbackTimeline.ts'
import { parseScoreJson } from '../src/music/score.ts'
import { readFileSync } from 'node:fs'

class FakeAudioParam {
  events = []

  setValueAtTime(value, time) {
    this.events.push({ type: 'set', value, time })
  }

  exponentialRampToValueAtTime(value, time) {
    this.events.push({ type: 'ramp', value, time })
  }
}

class FakeOscillator {
  type = 'sine'
  frequency = new FakeAudioParam()
  startTime = null
  stopTime = null
  onended = null
  connections = []

  connect(node) {
    this.connections.push(node)
  }

  disconnect() {}

  start(time) {
    this.startTime = time
  }

  stop(time) {
    this.stopTime = time
  }
}

class FakeGain {
  gain = new FakeAudioParam()

  connect() {}

  disconnect() {}
}

class FakeAudioContext {
  static latest
  static initialState = 'running'
  static initialResumeState = 'running'
  static closeShouldFail = false

  currentTime = 0
  state
  resumeState
  closeCalls = 0
  suspendCalls = 0
  resumeCalls = 0
  destination = {}
  oscillators = []
  stateChangeListeners = new Set()

  constructor() {
    this.state = FakeAudioContext.initialState
    this.resumeState = FakeAudioContext.initialResumeState
    FakeAudioContext.latest = this
  }

  addEventListener(type, listener) {
    if (type === 'statechange') {
      this.stateChangeListeners.add(listener)
    }
  }

  removeEventListener(type, listener) {
    if (type === 'statechange') {
      this.stateChangeListeners.delete(listener)
    }
  }

  setState(state) {
    this.state = state
    for (const listener of this.stateChangeListeners) {
      listener()
    }
  }

  async resume() {
    this.resumeCalls += 1
    this.setState(this.resumeState)
  }

  async suspend() {
    this.suspendCalls += 1
    this.setState('suspended')
  }

  async close() {
    this.closeCalls += 1
    if (FakeAudioContext.closeShouldFail) {
      throw new Error('Audio context could not be closed.')
    }
    this.setState('closed')
  }

  createOscillator() {
    const oscillator = new FakeOscillator()
    this.oscillators.push(oscillator)
    return oscillator
  }

  createGain() {
    return new FakeGain()
  }
}

const score = parseScoreJson(readFileSync('examples/test-lecture.json', 'utf8'))

describe('audio session setup', () => {
  it('requests automatic mode when the Audio Session API is available', () => {
    const navigatorLike = { audioSession: { type: 'playback' } }

    assert.equal(requestAutomaticAudioSession(navigatorLike), true)
    assert.equal(navigatorLike.audioSession.type, 'auto')
  })

  it('continues without changing anything when the Audio Session API is absent', () => {
    assert.equal(requestAutomaticAudioSession(undefined), false)
    assert.equal(requestAutomaticAudioSession({}), false)
  })

  it('falls back to the browser default if setting playback mode fails', (t) => {
    const originalInfo = console.info
    console.info = () => {}
    t.after(() => {
      console.info = originalInfo
    })

    const audioSession = {}
    Object.defineProperty(audioSession, 'type', {
      get: () => 'auto',
      set: () => {
        throw new Error('Audio session cannot be changed.')
      },
    })

    assert.equal(requestAutomaticAudioSession({ audioSession }), false)
  })
})

beforeEach(() => {
  FakeAudioContext.latest = null
  FakeAudioContext.initialState = 'running'
  FakeAudioContext.initialResumeState = 'running'
  FakeAudioContext.closeShouldFail = false
  globalThis.window = { AudioContext: FakeAudioContext }
  globalThis.document = { visibilityState: 'visible' }
})

describe('AudioEngine sequence playback', () => {
  it('resumes an initially suspended context when Start is pressed', async (t) => {
    FakeAudioContext.initialState = 'suspended'
    const engine = new AudioEngine()
    const contextStates = []
    engine.setContextStateHandler((state) => contextStates.push(state))

    await engine.start(120)
    t.after(() => engine.stop())

    const context = FakeAudioContext.latest
    assert.equal(context.suspendCalls, 0)
    assert.equal(context.resumeCalls, 1)
    assert.equal(context.state, 'running')
    assert.deepEqual(contextStates, ['suspended', 'running'])
    assert.equal(context.oscillators.length, 1)
  })

  it('reports a Start failure if the initially suspended context cannot resume', async () => {
    FakeAudioContext.initialState = 'suspended'
    FakeAudioContext.initialResumeState = 'suspended'
    const engine = new AudioEngine()

    await assert.rejects(engine.start(120), /browser did not allow audio playback to start/)
    assert.equal(FakeAudioContext.latest.resumeCalls, 1)
    assert.equal(FakeAudioContext.latest.state, 'suspended')
  })

  it('suspends and resumes a running context on every start', async (t) => {
    const engine = new AudioEngine()

    await engine.start(120)
    const context = FakeAudioContext.latest
    assert.equal(context.suspendCalls, 1)
    assert.equal(context.resumeCalls, 1)

    engine.stop()

    await engine.start(120)
    t.after(() => engine.stop())

    assert.equal(FakeAudioContext.latest, context)
    assert.equal(context.suspendCalls, 2)
    assert.equal(context.resumeCalls, 2)
    assert.equal(context.state, 'running')
    assert.equal(context.oscillators.length, 2)
    assert.equal(context.oscillators[1].startTime, context.currentTime + 0.05)
  })

  it('does not resume a context if stopped while its restart suspension is pending', async () => {
    FakeAudioContext.initialState = 'suspended'
    const engine = new AudioEngine()

    await engine.start(120)
    const context = FakeAudioContext.latest
    engine.stop()

    let finishSuspend
    context.suspend = () =>
      new Promise((resolve) => {
        finishSuspend = () => {
          context.setState('suspended')
          resolve()
        }
      })

    const restart = engine.start(120)
    assert.equal(typeof finishSuspend, 'function')
    engine.stop()
    finishSuspend()
    await restart

    assert.equal(context.resumeCalls, 1)
    assert.equal(context.state, 'suspended')
    assert.equal(context.oscillators.length, 1)
  })

  it('reports a restart failure if the context stays suspended after resume', async (t) => {
    const engine = new AudioEngine()

    await engine.start(120)
    const context = FakeAudioContext.latest
    engine.stop()

    context.resumeState = 'suspended'
    await assert.rejects(
      engine.start(120),
      /browser did not allow audio playback to start/,
    )
    t.after(() => engine.stop())

    assert.equal(context.suspendCalls, 2)
    assert.equal(context.resumeCalls, 2)
    assert.equal(context.state, 'suspended')
    assert.equal(context.oscillators.length, 1)
  })

  it('closes the old context and creates a new context with an audible test click', async (t) => {
    const engine = new AudioEngine()
    const contextStates = []
    engine.setContextStateHandler((state) => contextStates.push(state))

    await engine.start(120)
    const oldContext = FakeAudioContext.latest
    await engine.closeContext()

    assert.equal(oldContext.closeCalls, 1)
    assert.equal(oldContext.state, 'closed')
    assert.equal(oldContext.oscillators[0].stopTime, oldContext.currentTime)
    assert.equal(contextStates.at(-1), 'closed')

    FakeAudioContext.initialState = 'suspended'
    await engine.createFreshContextAndTest()
    t.after(() => engine.closeContext())

    const newContext = FakeAudioContext.latest
    assert.notEqual(newContext, oldContext)
    assert.equal(newContext.resumeCalls, 1)
    assert.equal(newContext.state, 'running')
    assert.equal(newContext.oscillators.length, 1)
    assert.equal(newContext.oscillators[0].startTime, 0.05)
    assert.equal(contextStates.at(-1), 'running')
  })

  it('reports a fresh-context test failure when the new context cannot resume', async () => {
    const engine = new AudioEngine()

    FakeAudioContext.initialState = 'suspended'
    FakeAudioContext.initialResumeState = 'suspended'
    await assert.rejects(
      engine.createFreshContextAndTest(),
      /browser did not allow audio playback to start/,
    )

    assert.equal(FakeAudioContext.latest.state, 'suspended')
    assert.equal(FakeAudioContext.latest.oscillators.length, 0)
  })

  it('surfaces a context close failure and can close it successfully afterward', async () => {
    const engine = new AudioEngine()
    await engine.start(120)
    const context = FakeAudioContext.latest

    FakeAudioContext.closeShouldFail = true
    await assert.rejects(
      engine.closeContext(),
      /Audio context could not be closed/,
    )
    assert.equal(context.state, 'running')

    FakeAudioContext.closeShouldFail = false
    await engine.closeContext()
    assert.equal(context.state, 'closed')
  })

  it('starts a regular pulse and applies tempo changes to the next beat', async (t) => {
    const engine = new AudioEngine()

    await engine.start(120)
    t.after(() => engine.stop())
    const context = FakeAudioContext.latest

    assert.equal(context.oscillators.length, 1)
    assert.equal(context.oscillators[0].startTime, 0.05)

    engine.setTempo(60)
    context.currentTime = 1
    engine.schedule()

    assert.equal(context.oscillators.length, 2)
    assert.ok(Math.abs(context.oscillators[1].startTime - 1.05) < 1e-9)
  })

  it('waits for the configured startup delay before a pulse or sequence', async (t) => {
    const pulseEngine = new AudioEngine()
    const pulseStartedAt = Date.now()
    const pulseStart = pulseEngine.start(120, 0.04)
    const pulseContext = FakeAudioContext.latest
    assert.equal(pulseContext.oscillators.length, 0)
    t.after(() => pulseEngine.stop())

    await pulseStart
    assert.ok(Date.now() - pulseStartedAt >= 30)
    assert.equal(pulseContext.oscillators.length, 1)

    pulseEngine.stop()
    const sequenceEngine = new AudioEngine()
    const timeline = buildPlaybackTimeline(score, {
      startMeasure: 1,
      endMeasure: 1,
      countInPulses: 1,
      loop: false,
    })
    const sequenceStartedAt = Date.now()
    await sequenceEngine.startSequence(
      timeline,
      120,
      undefined,
      undefined,
      undefined,
      0.04,
    )
    t.after(() => sequenceEngine.stop())

    assert.ok(Date.now() - sequenceStartedAt >= 30)
    assert.equal(FakeAudioContext.latest.oscillators.length, 1)
  })

  it('does not start playback if stopped during the startup delay', async () => {
    const engine = new AudioEngine()
    const pendingStart = engine.start(120, 0.05)
    const context = FakeAudioContext.latest

    await new Promise((resolve) => setTimeout(resolve, 5))
    engine.stop()
    await pendingStart

    assert.equal(context.oscillators.length, 0)
  })

  it('rejects startup delays outside the supported range', async () => {
    const engine = new AudioEngine()

    for (const delay of [-0.1, 2.1, Number.NaN]) {
      await assert.rejects(engine.start(120, delay), RangeError)
    }
  })

  it('omits later pulse clicks without shifting the beat schedule', async (t) => {
    let randomCalls = 0
    const engine = new AudioEngine(() => {
      randomCalls += 1
      return 0
    })
    engine.setClickSkipProbability(50)

    await engine.start(120)
    t.after(() => engine.stop())
    const context = FakeAudioContext.latest

    for (let beatIndex = 1; beatIndex <= 6; beatIndex += 1) {
      context.currentTime = beatIndex * 0.5
      engine.schedule()
    }

    assert.deepEqual(
      context.oscillators.map((oscillator) => oscillator.startTime),
      [0.05, 0.55, 1.05, 1.55, 2.05],
    )
    assert.equal(randomCalls, 2)

    engine.setClickSkipProbability(0)
    context.currentTime = 3.5
    engine.schedule()

    assert.equal(context.oscillators.at(-1).startTime, 3.55)
    assert.equal(randomCalls, 2)
  })

  it('always plays the count-in and first five sequence clicks', async (t) => {
    let randomCalls = 0
    const engine = new AudioEngine(() => {
      randomCalls += 1
      return 0
    })
    engine.setClickSkipProbability(50)
    const timeline = {
      initialEvents: [
        { kind: 'count-in', unitOffset: 0, pulseNumber: 1, totalPulses: 1 },
        ...Array.from({ length: 6 }, (_, index) => ({
          kind: index === 0 ? 'measure' : 'group',
          unitOffset: (index + 1) * 4,
          measureNumber: 1,
          groupNumber: index + 1,
        })),
      ],
      loopEvents: [],
      selectedMeasures: [],
      startMeasure: 1,
      endMeasure: 1,
      countInPulses: 1,
      countInUnits: 4,
      loopLengthUnits: 28,
      endUnitOffset: 32,
      elementaryUnitsPerTempoBeat: 4,
      loop: false,
      repeatMode: 'none',
      interCyclePauseSeconds: 0,
      tempoProgression: null,
    }

    await engine.startSequence(timeline, 120)
    t.after(() => engine.stop())
    const context = FakeAudioContext.latest

    for (let beatIndex = 1; beatIndex <= 6; beatIndex += 1) {
      context.currentTime = beatIndex * 0.5
      engine.schedule()
    }

    assert.deepEqual(
      context.oscillators.map((oscillator) => oscillator.startTime),
      [0.05, 0.55, 1.05, 1.55, 2.05, 2.55],
    )
    assert.equal(randomCalls, 1)
  })

  it('accepts only integer skip probabilities from zero to fifty percent', () => {
    const engine = new AudioEngine()

    for (const probability of [0, 10, 20, 30, 40, 50]) {
      assert.doesNotThrow(() => engine.setClickSkipProbability(probability))
    }
    for (const probability of [-10, 51, 10.5, Number.NaN]) {
      assert.throws(
        () => engine.setClickSkipProbability(probability),
        RangeError,
      )
    }
  })

  it('schedules measure accents and group clicks at AudioContext times', async (t) => {
    const timeline = buildPlaybackTimeline(score, {
      startMeasure: 1,
      endMeasure: 1,
      countInPulses: 0,
      loop: false,
    })
    const engine = new AudioEngine()

    await engine.startSequence(timeline, 120)
    t.after(() => engine.stop())
    const context = FakeAudioContext.latest

    assert.equal(context.oscillators.length, 1)
    assert.equal(context.oscillators[0].startTime, 0.05)
    assert.equal(context.oscillators[0].frequency.events[0].value, 1600)
    const measureEnvelope = context.oscillators[0].connections[0].gain.events
    assert.equal(measureEnvelope[0].value, 0.0001)
    assert.equal(measureEnvelope[1].value, 0.9)
    assert.ok(measureEnvelope[1].value < 1)
    assert.ok(Math.abs(measureEnvelope[1].time - 0.054) < 1e-9)
    assert.equal(measureEnvelope[2].value, 0.0001)
    assert.ok(Math.abs(measureEnvelope[2].time - 0.115) < 1e-9)

    engine.setTempo(60)
    context.currentTime = 1
    engine.schedule()

    assert.equal(context.oscillators.length, 2)
    assert.ok(Math.abs(context.oscillators[1].startTime - 1.05) < 1e-9)
    assert.equal(context.oscillators[1].frequency.events[0].value, 1200)
    const groupEnvelope = context.oscillators[1].connections[0].gain.events
    assert.equal(groupEnvelope[0].value, 0.0001)
    assert.equal(groupEnvelope[1].value, 0.6)
    assert.ok(groupEnvelope[1].value < 1)
    assert.ok(Math.abs(groupEnvelope[1].time - 1.054) < 1e-9)
    assert.equal(groupEnvelope[2].value, 0.0001)
    assert.ok(Math.abs(groupEnvelope[2].time - 1.1) < 1e-9)
  })

  it('plays the count-in once before continuous cycles and resumes at the measure', async (t) => {
    const timeline = buildPlaybackTimeline(score, {
      startMeasure: 1,
      endMeasure: 1,
      countInPulses: 2,
      loop: true,
    })
    const engine = new AudioEngine()

    await engine.startSequence(timeline, 120)
    t.after(() => engine.stop())
    const context = FakeAudioContext.latest
    assert.equal(context.oscillators.length, 1)
    assert.equal(context.oscillators[0]?.frequency.events[0]?.value, 1200)

    context.currentTime = 0.5
    engine.schedule()
    assert.equal(context.oscillators.length, 2)
    assert.equal(context.oscillators[1]?.frequency.events[0]?.value, 1200)

    context.currentTime = 3
    engine.schedule()

    const nextCycleMeasure = context.oscillators.at(-1)
    assert.ok(nextCycleMeasure)
    assert.equal(context.oscillators.length, 3)
    assert.ok(Math.abs(nextCycleMeasure.startTime - 3.05) < 1e-9)
    assert.equal(nextCycleMeasure.frequency.events[0].value, 1600)

    engine.stop()
  })

  it('pauses two seconds between cycles and counts in again after the pause', async (t) => {
    const timeline = buildPlaybackTimeline(score, {
      startMeasure: 1,
      endMeasure: 1,
      countInPulses: 1,
      repeatMode: 'pause',
    })
    const engine = new AudioEngine()

    await engine.startSequence(timeline, 120)
    t.after(() => engine.stop())
    const context = FakeAudioContext.latest

    context.currentTime = 4.5
    engine.schedule()

    const nextCountIn = context.oscillators.at(-1)
    assert.ok(nextCountIn)
    assert.ok(Math.abs(nextCountIn.startTime - 4.55) < 1e-9)
    assert.equal(nextCountIn.frequency.events[0].value, 1200)
    assert.equal(timeline.interCyclePauseSeconds, 2)

    engine.stop()
    const countAfterStop = context.oscillators.length
    context.currentTime = 8
    engine.schedule()
    assert.equal(context.oscillators.length, countAfterStop)
  })

  it('changes tempo between cycles and stops after the final tempo cycle', async (t) => {
    const timeline = buildPlaybackTimeline(score, {
      startMeasure: 1,
      endMeasure: 1,
      countInPulses: 1,
      repeatMode: 'tempo-progression',
      tempoProgression: { startTempo: 120, endTempo: 60, increment: 60 },
    })
    const engine = new AudioEngine()
    const tempoChanges = []

    await engine.startSequence(
      timeline,
      120,
      undefined,
      undefined,
      (nextTempo) => tempoChanges.push(nextTempo),
    )
    t.after(() => engine.stop())
    const context = FakeAudioContext.latest

    context.currentTime = 4.5
    engine.schedule()

    const secondCycleCountIn = context.oscillators.at(-1)
    assert.ok(secondCycleCountIn)
    assert.ok(Math.abs(secondCycleCountIn.startTime - 4.55) < 1e-9)
    assert.deepEqual(tempoChanges, [60])

    context.currentTime = 5.5
    engine.schedule()
    const secondCycleMeasure = context.oscillators.at(-1)
    assert.ok(secondCycleMeasure)
    assert.ok(Math.abs(secondCycleMeasure.startTime - 5.55) < 1e-9)
    assert.equal(secondCycleMeasure.frequency.events[0].value, 1600)

    context.currentTime = 6.5
    engine.schedule()
    const secondCycleGroup = context.oscillators.at(-1)
    assert.ok(secondCycleGroup)
    assert.ok(Math.abs(secondCycleGroup.startTime - 6.55) < 1e-9)

    context.currentTime = 9.55
    engine.schedule()
    assert.deepEqual(tempoChanges, [60])

    const oscillatorCountAfterCompletion = context.oscillators.length
    context.currentTime = 12
    engine.schedule()
    assert.equal(context.oscillators.length, oscillatorCountAfterCompletion)
  })

  it('cancels future clicks immediately on stop', async (t) => {
    const timeline = buildPlaybackTimeline(score, {
      startMeasure: 1,
      endMeasure: 1,
      countInPulses: 0,
      loop: false,
    })
    const engine = new AudioEngine()

    await engine.startSequence(timeline, 120)
    t.after(() => engine.stop())
    const context = FakeAudioContext.latest
    const scheduledClick = context.oscillators[0]

    engine.stop()

    assert.equal(scheduledClick.stopTime, context.currentTime)
  })

  it('automatically resumes a suspended pulse without replaying missed clicks', async (t) => {
    const engine = new AudioEngine()
    const contextStates = []
    engine.setContextStateHandler((state) => contextStates.push(state))

    await engine.start(120)
    t.after(() => engine.stop())
    const context = FakeAudioContext.latest

    context.currentTime = 1
    context.setState('suspended')
    const scheduledBeforeResume = context.oscillators.length

    await engine.resume()

    assert.equal(context.state, 'running')
    assert.equal(context.resumeCalls, 2)
    assert.deepEqual(contextStates.slice(-2), ['suspended', 'running'])
    assert.equal(context.oscillators.length, scheduledBeforeResume + 1)
    assert.ok(
      Math.abs(context.oscillators.at(-1).startTime - 1.005) < 1e-9,
    )
  })

  it('defers automatic resume while the page is hidden', async (t) => {
    const engine = new AudioEngine()

    await engine.start(120)
    t.after(() => engine.stop())
    const context = FakeAudioContext.latest

    globalThis.document.visibilityState = 'hidden'
    context.setState('suspended')

    assert.equal(context.resumeCalls, 1)
    assert.equal(context.state, 'suspended')

    globalThis.document.visibilityState = 'visible'
    await engine.resume()

    assert.equal(context.resumeCalls, 2)
    assert.equal(context.state, 'running')
  })

  it('keeps interruptions visible and allows a later forced resume', async (t) => {
    const engine = new AudioEngine()
    const originalInfo = console.info
    console.info = () => {}
    t.after(() => {
      console.info = originalInfo
    })

    await engine.start(120)
    t.after(() => engine.stop())
    const context = FakeAudioContext.latest

    context.resumeState = 'suspended'
    context.setState('suspended')

    await assert.rejects(engine.resume(), /did not allow audio playback to resume/)
    assert.equal(context.state, 'suspended')

    context.setState('interrupted')
    assert.equal(context.resumeCalls, 2)

    context.resumeState = 'running'
    await engine.resume(true)

    assert.equal(context.resumeCalls, 3)
    assert.equal(context.state, 'running')
  })

  it('creates a new audio context when a closed context is restarted', async (t) => {
    const engine = new AudioEngine()

    await engine.start(120)
    const closedContext = FakeAudioContext.latest
    globalThis.document.visibilityState = 'hidden'
    closedContext.setState('closed')
    engine.stop()

    globalThis.document.visibilityState = 'visible'
    await engine.start(120)
    t.after(() => engine.stop())

    assert.notEqual(FakeAudioContext.latest, closedContext)
    assert.equal(FakeAudioContext.latest.oscillators.length, 1)
  })

  it('creates a fresh context and starts playback after explicit closure', async (t) => {
    const engine = new AudioEngine()

    await engine.start(120)
    const closedContext = FakeAudioContext.latest
    await engine.closeContext()

    assert.equal(closedContext.state, 'closed')

    await engine.start(120)
    t.after(() => engine.stop())

    const freshContext = FakeAudioContext.latest
    assert.notEqual(freshContext, closedContext)
    assert.equal(freshContext.state, 'running')
    assert.equal(freshContext.oscillators.length, 1)
  })

  it('reports the count-in and measure only when their audio time is reached', async (t) => {
    const timeline = buildPlaybackTimeline(score, {
      startMeasure: 1,
      endMeasure: 1,
      countInPulses: 1,
      loop: false,
    })
    const engine = new AudioEngine()
    const progress = []

    await engine.startSequence(timeline, 120, (event) => progress.push(event))
    t.after(() => engine.stop())
    const context = FakeAudioContext.latest

    assert.deepEqual(progress, [])
    context.currentTime = 0.05
    engine.schedule()
    assert.deepEqual(progress, [
      { kind: 'count-in', unitOffset: 0, pulseNumber: 1, totalPulses: 1 },
    ])

    context.currentTime = 0.55
    engine.schedule()
    assert.deepEqual(progress[1], {
      kind: 'measure',
      unitOffset: 4,
      measureNumber: 1,
      groupNumber: 1,
    })
  })
})
