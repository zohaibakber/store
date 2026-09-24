export function forecastDemand(dailyUnits: ReadonlyArray<number>, observedDays: number) {
  const average = (start: number, days: number) => {
    const count = Math.min(days, Math.max(0, observedDays - start));
    if (count === 0) return 0;
    let total = 0;
    for (let index = start; index < start + count; index += 1) total += dailyUnits[index] ?? 0;
    return total / count;
  };
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
