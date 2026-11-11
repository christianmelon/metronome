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
  destination = {}
  oscillators = []

  constructor() {
    FakeAudioContext.latest = this
  }

  async resume() {
    this.state = 'running'
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
