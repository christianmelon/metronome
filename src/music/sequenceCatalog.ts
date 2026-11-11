import groupedFiveEight from '../../examples/grouped-5-8.json'
import steadyFourFour from '../../examples/steady-4-4.json'
import testSequence from '../../examples/test-lecture.json'
import { parseScore, type ParsedScore } from './score'

export interface SequenceCatalogEntry {
  id: string
  title: string
  description: string
  score: ParsedScore
}

function describeScore(score: ParsedScore): string {
  const meters = score.measures.reduce<string[]>((result, measure) => {
    if (result[result.length - 1] !== measure.meter.notation) {
      result.push(measure.meter.notation)
    }
    return result
  }, [])

  return `${score.measures.length} mesures · ${meters.join(' → ')}`
}

function createEntry(
  id: string,
  title: string,
  document: unknown,
): SequenceCatalogEntry {
  const score = parseScore(document)
  return {
    id,
    title,
    description: describeScore(score),
    score,
  }
}

export const SEQUENCE_CATALOG: readonly SequenceCatalogEntry[] = [
  createEntry('test-lecture', 'Séquence de test', testSequence),
  createEntry('steady-4-4', 'Pulsation régulière', steadyFourFour),
  createEntry('grouped-5-8', 'Mesure composée 5/8 (2 + 3)', groupedFiveEight),
]
