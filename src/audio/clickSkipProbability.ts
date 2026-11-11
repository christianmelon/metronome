export const MAX_CLICK_SKIP_PROBABILITY_PERCENT = 50

export function nextClickSkipProbability(percent: number): number {
  if (
    !Number.isInteger(percent) ||
    percent < 0 ||
    percent > MAX_CLICK_SKIP_PROBABILITY_PERCENT ||
    percent % 10 !== 0
  ) {
    throw new RangeError(
      'Click skip probability must be 0, 10, 20, 30, 40, or 50 percent.',
    )
  }

  return percent === MAX_CLICK_SKIP_PROBABILITY_PERCENT ? 0 : percent + 10
}
