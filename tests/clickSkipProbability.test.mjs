import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { nextClickSkipProbability } from '../src/audio/clickSkipProbability.ts'

describe('click skip probability cycle', () => {
  it('cycles in ten-percent steps and then disables', () => {
    const values = [0, 10, 20, 30, 40, 50]

    assert.deepEqual(values.map(nextClickSkipProbability), [10, 20, 30, 40, 50, 0])
  })

  it('rejects values outside the button cycle', () => {
    for (const value of [-10, 5, 60, Number.NaN]) {
      assert.throws(() => nextClickSkipProbability(value), RangeError)
    }
  })
})
