import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  adjacentMechanicalTempo,
  MAX_MECHANICAL_TEMPO_BPM,
  MECHANICAL_TEMPOS,
  MIN_MECHANICAL_TEMPO_BPM,
  nearestMechanicalTempo,
  tempoForAdjustmentMode,
  TEMPO_HOLD_ACCELERATION_MS,
  TEMPO_HOLD_DELAY_MS,
  tempoRepeatIntervalForHold,
  tempoStepForHold,
} from '../src/tempo.ts'

describe('tempo hold acceleration', () => {
  it('starts with one BPM steps and accelerates after a sustained hold', () => {
    assert.equal(TEMPO_HOLD_DELAY_MS, 400)
    assert.equal(tempoStepForHold(0), 1)
    assert.equal(tempoStepForHold(TEMPO_HOLD_ACCELERATION_MS - 1), 1)
    assert.equal(tempoStepForHold(TEMPO_HOLD_ACCELERATION_MS), 5)
  })

  it('accelerates mechanical repeats by cadence without skipping tempo values', () => {
    assert.equal(tempoRepeatIntervalForHold(0, 'mechanical'), 120)
    assert.equal(
      tempoRepeatIntervalForHold(TEMPO_HOLD_ACCELERATION_MS, 'mechanical'),
      60,
    )
    assert.equal(tempoRepeatIntervalForHold(TEMPO_HOLD_ACCELERATION_MS, 'standard'), 120)
  })
})

describe('mechanical tempo values', () => {
  it('builds the unique tempo ladder with the requested interval boundaries', () => {
    assert.deepEqual(MECHANICAL_TEMPOS, [
      40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60,
      63, 66, 69, 72,
      76, 80, 84, 88, 92, 96, 100, 104, 108, 112, 116, 120,
      126, 132, 138, 144,
      152, 160, 168, 176, 184, 192, 200, 208,
    ])
    assert.equal(MIN_MECHANICAL_TEMPO_BPM, 40)
    assert.equal(MAX_MECHANICAL_TEMPO_BPM, 208)
  })

  it('moves to adjacent allowed values across the shared boundaries', () => {
    assert.equal(adjacentMechanicalTempo(58, 1), 60)
    assert.equal(adjacentMechanicalTempo(60, 1), 63)
    assert.equal(adjacentMechanicalTempo(69, 1), 72)
    assert.equal(adjacentMechanicalTempo(72, 1), 76)
    assert.equal(adjacentMechanicalTempo(120, 1), 126)
    assert.equal(adjacentMechanicalTempo(144, 1), 152)
    assert.equal(adjacentMechanicalTempo(63, -1), 60)
    assert.equal(adjacentMechanicalTempo(76, -1), 72)
    assert.equal(adjacentMechanicalTempo(152, -1), 144)
    assert.equal(adjacentMechanicalTempo(40, -1), 40)
    assert.equal(adjacentMechanicalTempo(208, 1), 208)
  })

  it('normalizes out-of-range values and breaks ties toward the lower tempo', () => {
    assert.equal(nearestMechanicalTempo(30), 40)
    assert.equal(nearestMechanicalTempo(300), 208)
    assert.equal(nearestMechanicalTempo(59), 58)
    assert.equal(nearestMechanicalTempo(133), 132)
  })
})

describe('score tempo defaults', () => {
  it('uses the score tempo directly or its nearest mechanical value', () => {
    assert.equal(tempoForAdjustmentMode(120, 'standard'), 120)
    assert.equal(tempoForAdjustmentMode(120, 'mechanical'), 120)
    assert.equal(tempoForAdjustmentMode(123, 'mechanical'), 120)
  })
})
