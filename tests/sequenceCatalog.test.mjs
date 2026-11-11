import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { parseScoreJson } from '../src/music/score.ts'

const catalogFiles = [
  ['examples/test-lecture.json', 132],
  ['examples/steady-4-4.json', 120],
  ['examples/grouped-5-8.json', 120],
]

describe('predefined sequence documents', () => {
  for (const [fileName, expectedTempo] of catalogFiles) {
    it(`validates ${fileName}`, () => {
      const score = parseScoreJson(readFileSync(fileName, 'utf8'))

      assert.equal(score.tempo, expectedTempo)
      assert.ok(score.measures.length > 0)
    })
  }

  it('keeps the 5/8 preset grouped as two plus three eighth notes', () => {
    const score = parseScoreJson(readFileSync('examples/grouped-5-8.json', 'utf8'))

    assert.deepEqual(score.measures[0].groups, [4, 6])
  })
})
