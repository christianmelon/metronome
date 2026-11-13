import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { parseScoreJson } from '../src/music/score.ts'
import { SEQUENCE_CATALOG } from '../src/music/sequenceCatalog.ts'

const catalogFiles = [
  ['examples/Redline_tangp.json', 120],
]

describe('predefined sequence documents', () => {
  for (const [fileName, expectedTempo] of catalogFiles) {
    it(`validates ${fileName}`, () => {
      const score = parseScoreJson(readFileSync(fileName, 'utf8'))

      assert.equal(score.tempo, expectedTempo)
      assert.ok(score.measures.length > 0)
    })
  }

  it('offers Redline as the only sequence and makes it the default', () => {
    assert.deepEqual(
      SEQUENCE_CATALOG.map(({ id }) => id),
      ['redline-tango'],
    )
    assert.equal(SEQUENCE_CATALOG[0]?.title, 'Redline Tango')
  })

  it('loads the current Redline score including its default 2/4 grouping', () => {
    const score = parseScoreJson(readFileSync('examples/Redline_tangp.json', 'utf8'))
    assert.equal(score.tempo, 120)
    assert.equal(score.measures[0]?.number, 1)
    const twoFourMeasure = score.measures.find(({ number }) => number === 15)
    assert.equal(twoFourMeasure?.meter.notation, '2/4')
    assert.deepEqual(twoFourMeasure?.groups, [4, 4])
    assert.deepEqual(
      score.measures.map(({ number }) => number),
      Array.from({ length: score.measures.length }, (_, index) => index + 1),
    )
  })
})
