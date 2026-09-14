/** Most recent 24-hour bucket first. Missing sales are zero, not inferred lost demand. */
export function forecastDemand(dailyUnits: ReadonlyArray<number>, observedDays: number) {
  const average = (start: number, days: number) => {
    const count = Math.min(days, Math.max(0, observedDays - start));
    if (count === 0) return 0;
    let total = 0;
    for (let index = start; index < start + count; index += 1) total += dailyUnits[index] ?? 0;
    return total / count;
  };
  // Fourteen held-out days, with thirty strictly earlier days available for each origin.
  // https://otexts.com/fpp3/tscv.html describes rolling-origin evaluation without future leakage.
  const validationDays = 14;
  if (observedDays < 30 + validationDays || !dailyUnits.some((units) => units > 0)) {
    return { dailyDemand: average(0, 30), forecastDays: 30, backtestError: null };
  }
  const error = (days: number) => {
    let absoluteError = 0;
    for (let offset = 0; offset < validationDays; offset += 1) {
      absoluteError += Math.abs((dailyUnits[offset] ?? 0) - average(offset + 1, days));
    }
    return absoluteError / validationDays;
  };
  const shortError = error(7);
  const longError = error(30);
  const forecastDays = shortError < longError ? 7 : 30;
  return {
    dailyDemand: average(0, forecastDays),
    forecastDays,
    backtestError: Math.min(shortError, longError),
  };
}
