import redline from '../../examples/Redline_tangp.json' with { type: 'json' }
import redlineTango2 from '../../examples/Redline_tango_2.json' with { type: 'json' }
import grouped15_16 from '../../examples/grouped-15-16.json' with { type: 'json' }
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
  createEntry('redline-tango-2', 'Redline Tango 2', redlineTango2),
  createEntry('grouped-15-16', '15/16 — doubles croches (4+4+3+4)', grouped15_16),
]
