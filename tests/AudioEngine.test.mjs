import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { AudioEngine } from '../src/audio/AudioEngine.ts'
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

  currentTime = 0
  state = 'running'
  resumeState = 'running'
  destination = {}
  oscillators = []
  stateChangeListeners = new Set()

  constructor() {
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
    this.setState(this.resumeState)
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

beforeEach(() => {
  FakeAudioContext.latest = null
  globalThis.window = { AudioContext: FakeAudioContext }
})

describe('AudioEngine sequence playback', () => {
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
    assert.equal(context.oscillators[0].frequency.events[0].value, 2400)

    engine.setTempo(60)
    context.currentTime = 1
    engine.schedule()

    assert.equal(context.oscillators.length, 2)
    assert.ok(Math.abs(context.oscillators[1].startTime - 1.05) < 1e-9)
    assert.equal(context.oscillators[1].frequency.events[0].value, 1800)
    assert.equal(context.oscillators[1].connections[0].gain.events[1].value, 10)
  })

  it('starts the repeated range without repeating the count-in or bursting missed clicks', async (t) => {
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

    context.currentTime = 3
    engine.schedule()

    const lastClick = context.oscillators.at(-1)
    assert.ok(lastClick)
    assert.ok(Math.abs(lastClick.startTime - 3.05) < 1e-9)
    assert.equal(lastClick.frequency.events[0].value, 2400)

    engine.stop()
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

  it('resumes a suspended pulse without replaying missed clicks', async (t) => {
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
    assert.deepEqual(contextStates.slice(-2), ['suspended', 'running'])
    assert.equal(context.oscillators.length, scheduledBeforeResume + 1)
    assert.ok(
      Math.abs(context.oscillators.at(-1).startTime - 1.005) < 1e-9,
    )
  })

  it('keeps the audio context interrupted when the browser refuses to resume it', async (t) => {
    const engine = new AudioEngine()

    await engine.start(120)
    t.after(() => engine.stop())
    const context = FakeAudioContext.latest

    context.setState('suspended')
    context.resumeState = 'suspended'

    await assert.rejects(engine.resume(), /did not allow audio playback to resume/)
    assert.equal(context.state, 'suspended')
  })

  it('creates a new audio context when a closed context is restarted', async (t) => {
    const engine = new AudioEngine()

    await engine.start(120)
    const closedContext = FakeAudioContext.latest
    closedContext.setState('closed')
    engine.stop()

    await engine.start(120)
    t.after(() => engine.stop())

    assert.notEqual(FakeAudioContext.latest, closedContext)
    assert.equal(FakeAudioContext.latest.oscillators.length, 1)
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
