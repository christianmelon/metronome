import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { buildPlaybackTimeline, PlaybackRangeError } from '../src/music/playbackTimeline.ts'
import { parseScore, parseScoreJson } from '../src/music/score.ts'

const score = parseScore({
  tempo: 132,
  tempoUnit: { denominator: 4, elementaryUnitsPerTempoBeat: 4 },
  sequence: [
    { measures: '1', meter: '4/4' },
    { measures: '2-3', meter: '3/8' },
    { measures: '4', meter: '3/4' },
  ],
})

describe('buildPlaybackTimeline', () => {
  it('creates a four-pulse count-in and keeps group events in the selected measure range', () => {
    const timeline = buildPlaybackTimeline(score, {
      startMeasure: 1,
      endMeasure: 4,
      countInPulses: 4,
      loop: false,
    })

    assert.deepEqual(
      timeline.initialEvents.slice(0, 4).map(({ unitOffset, pulseNumber }) => ({
        unitOffset,
        pulseNumber,
      })),
      [
        { unitOffset: 0, pulseNumber: 1 },
        { unitOffset: 4, pulseNumber: 2 },
        { unitOffset: 8, pulseNumber: 3 },
        { unitOffset: 12, pulseNumber: 4 },
      ],
    )
    assert.deepEqual(timeline.initialEvents[4], {
      kind: 'measure',
      unitOffset: 16,
      measureNumber: 1,
      groupNumber: 1,
    })
    assert.equal(timeline.loopEvents.length, 13)
    assert.equal(timeline.endUnitOffset, 56)
    assert.equal(timeline.loopLengthUnits, 40)
  })

  it('builds a selected loop without repeating the count-in', () => {
    const timeline = buildPlaybackTimeline(score, {
      startMeasure: 2,
      endMeasure: 3,
      countInPulses: 0,
      loop: true,
    })

    assert.equal(timeline.initialEvents.length, 6)
    assert.equal(timeline.loopEvents.length, 6)
    assert.equal(timeline.loopLengthUnits, 12)
    assert.equal(timeline.initialEvents[0].measureNumber, 2)
    assert.equal(timeline.initialEvents[0].unitOffset, 0)
    assert.equal(timeline.loop, true)
  })

  it('plays Redline from measure 105 through 120', () => {
    const redline = parseScoreJson(
      readFileSync('examples/Redline_tangp.json', 'utf8'),
    )
    const timeline = buildPlaybackTimeline(redline, {
      startMeasure: 105,
      endMeasure: 120,
      countInPulses: 0,
      loop: false,
    })

    assert.deepEqual(
      timeline.selectedMeasures.map(({ number }) => number),
      Array.from({ length: 16 }, (_, index) => 105 + index),
    )
    assert.deepEqual(
      [...new Set(timeline.loopEvents.map(({ measureNumber }) => measureNumber))],
      Array.from({ length: 16 }, (_, index) => 105 + index),
    )
    assert.equal(timeline.loopLengthUnits, 172)
  })

  it('rejects reversed, out-of-range, and invalid count-in options', () => {
    for (const options of [
      { startMeasure: 3, endMeasure: 2, countInPulses: 4, loop: false },
      { startMeasure: 1, endMeasure: 5, countInPulses: 4, loop: false },
      { startMeasure: 1, endMeasure: 4, countInPulses: 33, loop: false },
    ]) {
      assert.throws(() => buildPlaybackTimeline(score, options), PlaybackRangeError)
    }
  })
})
