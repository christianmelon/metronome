import { MAX_TEMPO_BPM, MIN_TEMPO_BPM } from '../tempo.ts'

const MAX_MEASURES = 100_000
const MAX_SEQUENCE_EVENTS = 1_000_000
const MAX_UNITS_PER_MEASURE = 65_536
const MAX_NUMERATOR = 4_096
const MAX_ELEMENTARY_UNITS_PER_TEMPO_BEAT = 256
const MAX_NOTE_DENOMINATOR = 64

const DEFAULT_GROUP_COUNTS: Record<string, number> = {
  '3/4': 3,
  '4/4': 4,
  '5/4': 5,
  '3/8': 3,
}

export interface TempoUnitMapping {
  denominator: number
  elementaryUnitsPerTempoBeat: number
}

export interface ScoreSegment {
  measures: string
  meter: string
  groups?: number[]
}

export interface ScoreDocument {
  tempo: number
  tempoUnit: TempoUnitMapping
  sequence: ScoreSegment[]
}

export interface Meter {
  notation: string
  numerator: number
  denominator: number
}

export interface ExpandedMeasure {
  number: number
  meter: Meter
  groups: number[]
  unitsPerMeterBeat: number
  absoluteUnitOffset: number
}

export interface RhythmicUnitEvent {
  measureNumber: number
  groupNumber: number
  unitOffset: number
  absoluteUnitOffset: number
  startsGroup: boolean
}

export interface ParsedScore {
  tempo: number
  tempoUnit: TempoUnitMapping
  measures: ExpandedMeasure[]
  events: RhythmicUnitEvent[]
  totalElementaryUnits: number
}

export class ScoreValidationError extends Error {
  readonly path: string

  constructor(
    path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'ScoreValidationError'
    this.path = path
  }
}

export function parseScoreJson(json: string): ParsedScore {
  let value: unknown

  try {
    value = JSON.parse(json)
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      throw new ScoreValidationError('$', 'contains invalid JSON')
    }
    throw error
  }

  return parseScore(value)
}

export function parseScore(value: unknown): ParsedScore {
  const score = asRecord(value, '$')
  assertOnlyKeys(score, ['tempo', 'tempoUnit', 'sequence'], '$')

  const tempo = asNumber(score.tempo, '$.tempo')
  if (tempo < MIN_TEMPO_BPM || tempo > MAX_TEMPO_BPM) {
    fail('$.tempo', `must be between ${MIN_TEMPO_BPM} and ${MAX_TEMPO_BPM} BPM`)
  }

  const tempoUnitRecord = asRecord(score.tempoUnit, '$.tempoUnit')
  assertOnlyKeys(
    tempoUnitRecord,
    ['denominator', 'elementaryUnitsPerTempoBeat'],
    '$.tempoUnit',
  )

  const tempoUnit: TempoUnitMapping = {
    denominator: asNoteDenominator(tempoUnitRecord.denominator, '$.tempoUnit.denominator'),
    elementaryUnitsPerTempoBeat: asPositiveInteger(
      tempoUnitRecord.elementaryUnitsPerTempoBeat,
      '$.tempoUnit.elementaryUnitsPerTempoBeat',
      MAX_ELEMENTARY_UNITS_PER_TEMPO_BEAT,
    ),
  }

  if (!Array.isArray(score.sequence) || score.sequence.length === 0) {
    fail('$.sequence', 'must be a non-empty array')
  }

  const measures: ExpandedMeasure[] = []
  const events: RhythmicUnitEvent[] = []
  let nextMeasureNumber = 1
  let totalElementaryUnits = 0

  for (const [segmentIndex, rawSegment] of score.sequence.entries()) {
    const path = `$.sequence[${segmentIndex}]`
    const segment = asRecord(rawSegment, path)
    assertOnlyKeys(segment, ['measures', 'meter', 'groups'], path)

    const range = parseMeasureRange(segment.measures, `${path}.measures`)
    if (range.start !== nextMeasureNumber) {
      fail(
        `${path}.measures`,
        `must continue the sequence at measure ${nextMeasureNumber}`,
      )
    }

    const meter = parseMeter(segment.meter, `${path}.meter`)
    const unitsPerMeterBeatNumerator =
      tempoUnit.elementaryUnitsPerTempoBeat * tempoUnit.denominator
    if (unitsPerMeterBeatNumerator % meter.denominator !== 0) {
      fail(
        '$.tempoUnit',
        `does not map exactly to the ${meter.denominator}th-note unit in ${meter.notation}`,
      )
    }

    const unitsPerMeterBeat = unitsPerMeterBeatNumerator / meter.denominator
    const unitsPerMeasure = meter.numerator * unitsPerMeterBeat
    if (
      !Number.isSafeInteger(unitsPerMeasure) ||
      unitsPerMeasure > MAX_UNITS_PER_MEASURE
    ) {
      fail(`${path}.meter`, `cannot exceed ${MAX_UNITS_PER_MEASURE} elementary units per measure`)
    }

    const groups = parseGroups(
      segment.groups,
      meter,
      unitsPerMeterBeat,
      unitsPerMeasure,
      `${path}.groups`,
    )
    const measureCount = range.end - range.start + 1
    if (measures.length + measureCount > MAX_MEASURES) {
      fail('$.sequence', `cannot expand to more than ${MAX_MEASURES} measures`)
    }

    for (let measureNumber = range.start; measureNumber <= range.end; measureNumber += 1) {
      if (totalElementaryUnits + unitsPerMeasure > MAX_SEQUENCE_EVENTS) {
        fail('$.sequence', `cannot generate more than ${MAX_SEQUENCE_EVENTS} rhythmic-unit events`)
      }

      const measureOffset = totalElementaryUnits
      measures.push({
        number: measureNumber,
        meter: { ...meter },
        groups: [...groups],
        unitsPerMeterBeat,
        absoluteUnitOffset: measureOffset,
      })

      let unitOffset = 0
      for (const [groupIndex, groupLength] of groups.entries()) {
        for (let unitInGroup = 0; unitInGroup < groupLength; unitInGroup += 1) {
          events.push({
            measureNumber,
            groupNumber: groupIndex + 1,
            unitOffset,
            absoluteUnitOffset: measureOffset + unitOffset,
            startsGroup: unitInGroup === 0,
          })
          unitOffset += 1
        }
      }

      totalElementaryUnits += unitsPerMeasure
      if (!Number.isSafeInteger(totalElementaryUnits)) {
        fail('$.sequence', 'contains too many elementary units')
      }
    }

    nextMeasureNumber = range.end + 1
  }

  return {
    tempo,
    tempoUnit,
    measures,
    events,
    totalElementaryUnits,
  }
}

function parseMeasureRange(
  value: unknown,
  path: string,
): { start: number; end: number } {
  if (typeof value !== 'string') {
    fail(path, 'must be a measure number or an inclusive range such as "1-4"')
  }

  const match = /^\s*([1-9]\d*)(?:\s*-\s*([1-9]\d*))?\s*$/.exec(value)
  if (!match) {
    fail(path, 'must use a positive measure number or an inclusive range such as "1-4"')
  }

  const start = Number(match[1])
  const end = match[2] === undefined ? start : Number(match[2])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) {
    fail(path, 'must be an ascending range of safe positive integers')
  }
  if (end > MAX_MEASURES) {
    fail(path, `cannot exceed measure ${MAX_MEASURES}`)
  }

  return { start, end }
}

function parseMeter(value: unknown, path: string): Meter {
  if (typeof value !== 'string') {
    fail(path, 'must be a meter string such as "4/4"')
  }

  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value)
  if (!match) {
    fail(path, 'must use the form "numerator/denominator"')
  }

  const numerator = Number(match[1])
  const denominator = Number(match[2])
  if (!Number.isSafeInteger(numerator) || numerator > MAX_NUMERATOR) {
    fail(path, `numerator must be between 1 and ${MAX_NUMERATOR}`)
  }

  if (
    !Number.isSafeInteger(denominator) ||
    denominator > MAX_NOTE_DENOMINATOR ||
    !isPowerOfTwo(denominator)
  ) {
    fail(path, `denominator must be a power of two no greater than ${MAX_NOTE_DENOMINATOR}`)
  }

  return { notation: value, numerator, denominator }
}

function parseGroups(
  value: unknown,
  meter: Meter,
  unitsPerMeterBeat: number,
  unitsPerMeasure: number,
  path: string,
): number[] {
  let groups: number[]

  if (value === undefined) {
    const defaultGroupCount = DEFAULT_GROUP_COUNTS[meter.notation]
    if (defaultGroupCount === undefined) {
      fail(path, `is required when meter ${meter.notation} has no default grouping`)
    }
    groups = Array.from({ length: defaultGroupCount }, () => unitsPerMeterBeat)
  } else {
    if (!Array.isArray(value) || value.length === 0) {
      fail(path, 'must be a non-empty array of positive integer unit counts')
    }
    groups = value.map((group, index) =>
      asPositiveInteger(group, `${path}[${index}]`, MAX_UNITS_PER_MEASURE),
    )
  }

  const totalGroupUnits = groups.reduce((sum, group) => sum + group, 0)
  if (totalGroupUnits !== unitsPerMeasure) {
    fail(path, `must add up to ${unitsPerMeasure} elementary units for ${meter.notation}`)
  }

  return groups
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'must be an object')
  }
  return value as Record<string, unknown>
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, 'must be a finite number')
  }
  return value
}

function asPositiveInteger(
  value: unknown,
  path: string,
  maximum: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    fail(path, `must be a positive integer no greater than ${maximum}`)
  }
  return value
}

function asNoteDenominator(value: unknown, path: string): number {
  const denominator = asPositiveInteger(value, path, MAX_NOTE_DENOMINATOR)
  if (!isPowerOfTwo(denominator)) {
    fail(path, `must be a power of two no greater than ${MAX_NOTE_DENOMINATOR}`)
  }
  return denominator
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      fail(`${path}.${key}`, 'is not a supported property')
    }
  }
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && Math.log2(value) % 1 === 0
}

function fail(path: string, message: string): never {
  throw new ScoreValidationError(path, message)
}
