import type { DemandForecast } from "@store/contracts/sync/replica-analytics";

import { mean, sum } from "./statistics";

type DemandPattern = DemandForecast["pattern"];
export type DemandTrend = DemandForecast["trend"];
type DemandConfidence = DemandForecast["confidence"];

const ADI_CUTOFF = 1.32;
const CV2_CUTOFF = 0.49;
const SES_ALPHAS = [0.05, 0.1, 0.2, 0.3, 0.5] as const;
const SBA_ALPHAS = [0.05, 0.1, 0.2, 0.3] as const;
const WARM_UP_DAYS = 7;
const TREND_RECENT_DAYS = 14;
const TREND_MIN_BASELINE_DAYS = 14;
const TREND_MAX_BASELINE_DAYS = 42;
const TREND_Z_CUTOFF = 2;
const TREND_RISE_RATIO = 1.25;
const TREND_FALL_RATIO = 0.8;
const TREND_MIN_UNITS = 10;

type Fit = { readonly forecast: number; readonly mae: number; readonly rmse: number };

const scoreErrors = (errors: { absolute: number; squared: number; count: number }) => ({
  mae: errors.count === 0 ? 0 : errors.absolute / errors.count,
  rmse: errors.count === 0 ? 0 : Math.sqrt(errors.squared / errors.count),
});

const fitSes = (series: ArrayLike<number>, alpha: number): Fit => {
  let level = mean(series, 0, Math.min(WARM_UP_DAYS, series.length));
  const errors = { absolute: 0, squared: 0, count: 0 };
  for (let index = 0; index < series.length; index += 1) {
    const actual = series[index] ?? 0;
    const error = actual - level;
    if (index >= WARM_UP_DAYS) {
      errors.absolute += Math.abs(error);
      errors.squared += error * error;
      errors.count += 1;
    }
    level += alpha * error;
  }
  return { forecast: level, ...scoreErrors(errors) };
};

const fitSba = (series: ArrayLike<number>, alpha: number): Fit => {
  const sbaBiasCorrection = 1 - alpha / 2;
  let size = 0;
  let interval = 0;
  let sinceLast = 1;
  let started = false;
  const errors = { absolute: 0, squared: 0, count: 0 };
  for (let index = 0; index < series.length; index += 1) {
    const actual = series[index] ?? 0;
    if (started && index >= WARM_UP_DAYS) {
      const error = actual - (sbaBiasCorrection * size) / interval;
      errors.absolute += Math.abs(error);
      errors.squared += error * error;
      errors.count += 1;
    }
    if (actual > 0) {
      if (started) {
        size += alpha * (actual - size);
        interval += alpha * (sinceLast - interval);
      } else {
        size = actual;
        interval = index + 1;
        started = true;
      }
      sinceLast = 1;
    } else {
      sinceLast += 1;
    }
  }
  const forecast = started ? (sbaBiasCorrection * size) / Math.max(interval, 1) : 0;
  return { forecast, ...scoreErrors(errors) };
};

const bestFit = (
  series: ArrayLike<number>,
  alphas: ReadonlyArray<number>,
  fit: (series: ArrayLike<number>, alpha: number) => Fit,
) => {
  let best: Fit | undefined;
  for (const alpha of alphas) {
    const candidate = fit(series, alpha);
    if (best === undefined || candidate.mae < best.mae) best = candidate;
  }
  return best ?? { forecast: 0, mae: 0, rmse: 0 };
};

const classify = (series: ArrayLike<number>) => {
  let sellingDays = 0;
  let sizeTotal = 0;
  let sizeSquares = 0;
  for (let index = 0; index < series.length; index += 1) {
    const value = series[index] ?? 0;
    if (value <= 0) continue;
    sellingDays += 1;
    sizeTotal += value;
    sizeSquares += value * value;
  }
  if (sellingDays === 0) return { pattern: "none" as const, sellingDays };
  if (sellingDays < 3) return { pattern: "sparse" as const, sellingDays };
  const adi = series.length / sellingDays;
  const sizeMean = sizeTotal / sellingDays;
  const variance = Math.max(0, sizeSquares / sellingDays - sizeMean * sizeMean);
  const cv2 = variance / (sizeMean * sizeMean);
  const pattern: DemandPattern =
    adi < ADI_CUTOFF
      ? cv2 < CV2_CUTOFF
        ? "smooth"
        : "erratic"
      : cv2 < CV2_CUTOFF
        ? "intermittent"
        : "lumpy";
  return { pattern, sellingDays };
};

const detectTrend = (series: ArrayLike<number>) => {
  const recentDays = Math.min(TREND_RECENT_DAYS, series.length);
  const baselineDays = Math.min(TREND_MAX_BASELINE_DAYS, series.length - recentDays);
  if (baselineDays < TREND_MIN_BASELINE_DAYS) return { trend: "unknown" as const, ratio: null };
  const end = series.length;
  const recent = sum(series, end - recentDays, end);
  const baseline = sum(series, end - recentDays - baselineDays, end - recentDays);
  if (recent + baseline < TREND_MIN_UNITS) return { trend: "unknown" as const, ratio: null };
  const recentRate = recent / recentDays;
  const baselineRate = baseline / baselineDays;
  const pooledPoissonRate = (recent + baseline) / (recentDays + baselineDays);
  const z =
    (recentRate - baselineRate) /
    Math.sqrt(pooledPoissonRate * (1 / recentDays + 1 / baselineDays));
  const ratio = baselineRate === 0 ? null : recentRate / baselineRate;
  const trend: DemandTrend =
    z >= TREND_Z_CUTOFF && (ratio === null || ratio >= TREND_RISE_RATIO)
      ? "rising"
      : z <= -TREND_Z_CUTOFF && ratio !== null && ratio <= TREND_FALL_RATIO
        ? "falling"
        : "steady";
  return { trend, ratio };
};

const confidenceOf = (observedDays: number, sellingDays: number): DemandConfidence =>
  observedDays >= 56 && sellingDays >= 14
    ? "high"
    : observedDays >= 21 && sellingDays >= 5
      ? "medium"
      : "low";

export const forecastDemand = (series: ArrayLike<number>): DemandForecast => {
  const observedDays = series.length;
  const { pattern, sellingDays } = classify(series);
  const { trend, ratio } = detectTrend(series);
  const base = {
    pattern,
    trend,
    trendRatio: ratio,
    observedDays,
    sellingDays,
    confidence: confidenceOf(observedDays, sellingDays),
  };
  if (pattern === "none") {
    return { ...base, dailyRate: 0, dailyDeviation: 0, method: "none", meanAbsoluteError: null };
  }
  if (pattern === "sparse" || observedDays <= WARM_UP_DAYS) {
    const rate = mean(series);
    return {
      ...base,
      dailyRate: rate,
      dailyDeviation: Math.sqrt(rate),
      method: "average",
      meanAbsoluteError: null,
    };
  }
  const intermittent = pattern === "intermittent" || pattern === "lumpy";
  const fit = intermittent
    ? bestFit(series, SBA_ALPHAS, fitSba)
    : bestFit(series, SES_ALPHAS, fitSes);
  return {
    ...base,
    dailyRate: Math.max(0, fit.forecast),
    dailyDeviation: Math.max(fit.rmse, Math.sqrt(Math.max(0, fit.forecast))),
    method: intermittent ? "sba" : "ses",
    meanAbsoluteError: fit.mae,
  };
};
