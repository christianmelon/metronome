import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { parseScoreJson } from '../src/music/score.ts'
import { SEQUENCE_CATALOG } from '../src/music/sequenceCatalog.ts'

const catalogFiles = [
  ['examples/Redline_tangp.json', 80],
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

  it('keeps Redline measures 105-120 with the requested meters and groupings', () => {
    const score = parseScoreJson(readFileSync('examples/Redline_tangp.json', 'utf8'))

    assert.deepEqual(
      score.measures.map(({ number, meter, groups }) => [
        number,
        meter.notation,
        groups,
      ]),
      [
        [105, '5/8', [6, 4]],
        [106, '3/4', [4, 4, 4]],
        [107, '5/8', [6, 4]],
        [108, '4/4', [4, 4, 4, 4]],
        [109, '5/8', [6, 4]],
        [110, '3/4', [4, 4, 4]],
        [111, '3/8', [2, 2, 2]],
        [112, '5/8', [6, 4]],
        [113, '6/8', [6, 6]],
        [114, '6/8', [6, 6]],
        [115, '5/8', [6, 4]],
        [116, '3/4', [4, 4, 4]],
        [117, '3/8', [2, 2, 2]],
        [118, '5/8', [6, 4]],
        [119, '6/8', [6, 6]],
        [120, '6/8', [6, 6]],
      ],
    )
  })
})
