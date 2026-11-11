export const MIN_TEMPO_BPM = 30
export const MAX_TEMPO_BPM = 300
export const MIN_MECHANICAL_TEMPO_BPM = 40
export const MAX_MECHANICAL_TEMPO_BPM = 208
export const TEMPO_HOLD_DELAY_MS = 400
export const TEMPO_HOLD_REPEAT_MS = 120
export const TEMPO_MECHANICAL_FAST_REPEAT_MS = 60
export const TEMPO_HOLD_ACCELERATION_MS = 1_500

const MECHANICAL_TEMPO_RANGES: ReadonlyArray<readonly [number, number, number]> = [
  [40, 60, 2],
  [60, 72, 3],
  [72, 120, 4],
  [120, 144, 6],
  [144, 208, 8],
]

export const MECHANICAL_TEMPOS: readonly number[] = Object.freeze(
  [...new Set(
    MECHANICAL_TEMPO_RANGES.flatMap(([start, end, step]) =>
      Array.from(
        { length: Math.floor((end - start) / step) + 1 },
        (_, index) => start + index * step,
      ),
    ),
  )].sort((left, right) => left - right),
)

export function tempoStepForHold(holdDurationMs: number): number {
  return holdDurationMs >= TEMPO_HOLD_ACCELERATION_MS ? 5 : 1
}

export function tempoRepeatIntervalForHold(
  holdDurationMs: number,
  mode: 'standard' | 'mechanical',
): number {
  return mode === 'mechanical' && holdDurationMs >= TEMPO_HOLD_ACCELERATION_MS
    ? TEMPO_MECHANICAL_FAST_REPEAT_MS
    : TEMPO_HOLD_REPEAT_MS
}

export function adjacentMechanicalTempo(tempo: number, direction: -1 | 1): number {
  if (!Number.isFinite(tempo)) {
    throw new RangeError('Tempo must be a finite number.')
  }

  if (direction === 1) {
    return MECHANICAL_TEMPOS.find((candidate) => candidate > tempo) ??
      MECHANICAL_TEMPOS[MECHANICAL_TEMPOS.length - 1]!
  }

  for (let index = MECHANICAL_TEMPOS.length - 1; index >= 0; index -= 1) {
    const candidate = MECHANICAL_TEMPOS[index]!
    if (candidate < tempo) {
      return candidate
    }
  }
  return MECHANICAL_TEMPOS[0]!
}

export function nearestMechanicalTempo(tempo: number): number {
  if (!Number.isFinite(tempo)) {
    throw new RangeError('Tempo must be a finite number.')
  }

  return MECHANICAL_TEMPOS.reduce((nearest, candidate) => {
    const candidateDistance = Math.abs(candidate - tempo)
    const nearestDistance = Math.abs(nearest - tempo)
    return candidateDistance < nearestDistance ||
      (candidateDistance === nearestDistance && candidate < nearest)
      ? candidate
      : nearest
  }, MECHANICAL_TEMPOS[0]!)
}
