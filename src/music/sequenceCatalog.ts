import redline from '../../examples/Redline_tangp.json' with { type: 'json' }
import { parseScore, type ParsedScore } from './score.ts'

export interface SequenceCatalogEntry {
  id: string
  title: string
  score: ParsedScore
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
    score,
  }
}

export const SEQUENCE_CATALOG: readonly SequenceCatalogEntry[] = [
  createEntry('redline-tango', 'Redline Tango', redline),
]
