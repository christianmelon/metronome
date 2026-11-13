import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseScore,
  parseScoreJson,
  ScoreValidationError,
} from '../src/music/score.ts'

const exampleScore = {
  tempo: 132,
  tempoUnit: {
    denominator: 4,
    elementaryUnitsPerTempoBeat: 4,
  },
  sequence: [
    { measures: '1-4', meter: '4/4' },
    { measures: '5-10', meter: '15/16', groups: [4, 4, 3, 4] },
    { measures: '11-12', meter: '3/4' },
    { measures: '13', meter: '3/8' },
    { measures: '14-17', meter: '4/4' },
  ],
}

describe('parseScoreJson', () => {
  it('expands defaults, custom groups, and inclusive measure ranges', () => {
    const score = parseScoreJson(JSON.stringify(exampleScore))

    assert.equal(score.tempo, 132)
    assert.equal(score.measures.length, 17)
    assert.deepEqual(score.measures[0], {
      number: 1,
      meter: { notation: '4/4', numerator: 4, denominator: 4 },
      groups: [4, 4, 4, 4],
      unitsPerMeterBeat: 4,
      absoluteUnitOffset: 0,
    })
    assert.deepEqual(score.measures[4].groups, [4, 4, 3, 4])
    assert.equal(score.measures[4].absoluteUnitOffset, 64)
    assert.deepEqual(score.measures[12].groups, [2, 2, 2])
    assert.equal(score.measures[16].number, 17)
    assert.equal(score.totalElementaryUnits, 248)
    assert.equal(score.events.length, 248)
    assert.equal(score.events.filter((event) => event.startsGroup).length, 65)
    assert.deepEqual(score.events.slice(0, 5), [
      {
        measureNumber: 1,
        groupNumber: 1,
        unitOffset: 0,
        absoluteUnitOffset: 0,
        startsGroup: true,
      },
      {
        measureNumber: 1,
        groupNumber: 1,
        unitOffset: 1,
        absoluteUnitOffset: 1,
        startsGroup: false,
      },
      {
        measureNumber: 1,
        groupNumber: 1,
        unitOffset: 2,
        absoluteUnitOffset: 2,
        startsGroup: false,
      },
      {
        measureNumber: 1,
        groupNumber: 1,
        unitOffset: 3,
        absoluteUnitOffset: 3,
        startsGroup: false,
      },
      {
        measureNumber: 1,
        groupNumber: 2,
        unitOffset: 4,
        absoluteUnitOffset: 4,
        startsGroup: true,
      },
    ])
  })

  it('uses the explicit tempo-unit mapping for other meter denominators', () => {
    const score = parseScore({
      tempo: 100,
      tempoUnit: {
        denominator: 4,
        elementaryUnitsPerTempoBeat: 8,
      },
      sequence: [{ measures: '1', meter: '3/8' }],
    })

    assert.deepEqual(score.measures[0].groups, [4, 4, 4])
    assert.equal(score.totalElementaryUnits, 12)
  })

  it('uses the documented default grouping for 5/4', () => {
    const score = parseScore({
      tempo: 100,
      tempoUnit: { denominator: 4, elementaryUnitsPerTempoBeat: 4 },
      sequence: [{ measures: '1', meter: '5/4' }],
    })

    assert.deepEqual(score.measures[0].groups, [4, 4, 4, 4, 4])
  })

  it('uses two quarter-note groups by default for 2/4', () => {
    const score = parseScore({
      tempo: 120,
      tempoUnit: { denominator: 4, elementaryUnitsPerTempoBeat: 4 },
      sequence: [{ measures: '1', meter: '2/4' }],
    })

    assert.deepEqual(score.measures[0].groups, [4, 4])
    assert.equal(score.totalElementaryUnits, 8)
  })

  it('accepts a positive starting measure and contiguous later ranges', () => {
    const score = parseScore({
      tempo: 120,
      tempoUnit: { denominator: 4, elementaryUnitsPerTempoBeat: 4 },
      sequence: [
        { measures: '105-106', meter: '4/4' },
        { measures: '107-108', meter: '4/4' },
      ],
    })

    assert.deepEqual(score.measures.map(({ number }) => number), [105, 106, 107, 108])
    assert.deepEqual(
      [...new Set(score.events.map(({ measureNumber }) => measureNumber))],
      [105, 106, 107, 108],
    )
  })

  it('rejects invalid JSON with a useful validation error', () => {
    assert.throws(() => parseScoreJson('{'), {
      name: 'ScoreValidationError',
      message: /contains invalid JSON/,
    })
  })

  for (const [description, segment] of [
    ['unknown meter without groups', { measures: '1', meter: '6/8' }],
    [
      'groups that do not fill a measure',
      { measures: '1', meter: '15/16', groups: [4, 4, 4, 4] },
    ],
    ['a reversed range', { measures: '1-0', meter: '4/4' }],
    [
      'a non-power-of-two denominator',
      { measures: '1', meter: '7/12', groups: [1] },
    ],
  ]) {
    it(`rejects ${description}`, () => {
      assert.throws(
        () => parseScore({ ...exampleScore, sequence: [segment] }),
        ScoreValidationError,
      )
    })
  }

  it('rejects a gap after an arbitrary starting measure', () => {
    assert.throws(
      () =>
        parseScore({
          ...exampleScore,
          sequence: [
            { measures: '105-106', meter: '4/4' },
            { measures: '108', meter: '4/4' },
          ],
        }),
      /must continue the sequence at measure 107/,
    )
  })

  it('rejects mappings that cannot represent the meter with whole elementary units', () => {
    assert.throws(
      () =>
        parseScore({
          tempo: 120,
          tempoUnit: { denominator: 4, elementaryUnitsPerTempoBeat: 1 },
          sequence: [{ measures: '1', meter: '3/8', groups: [1, 1, 1] }],
        }),
      /does not map exactly/,
    )
  })

  it('rejects a tempo outside the supported range', () => {
    assert.throws(
      () => parseScore({ ...exampleScore, tempo: 301 }),
      /must be between 30 and 300 BPM/,
    )
  })
})
