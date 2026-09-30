import { statSync } from "node:fs";
import { getHeapStatistics } from "node:v8";

import * as Schema from "effect/Schema";

export const Summary = Schema.Struct({
  count: Schema.Number,
  min: Schema.Number,
  mean: Schema.Number,
  p50: Schema.Number,
  p95: Schema.Number,
  p99: Schema.Number,
  max: Schema.Number,
});
export type Summary = typeof Summary.Type;

const rank = (sorted: ReadonlyArray<number>, quantile: number): number => {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index] ?? 0;
};

export const summarize = (values: ReadonlyArray<number>): Summary => {
  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    mean: sorted.length === 0 ? 0 : total / sorted.length,
    p50: rank(sorted, 0.5),
    p95: rank(sorted, 0.95),
    p99: rank(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? 0,
  };
};

const MIB = 1024 * 1024;

export const MemoryPeak = Schema.Struct({
  rssMaxMiB: Schema.Number,
  rssBaselineMiB: Schema.Number,
  heapUsedPeakMiB: Schema.Number,
  heapTotalPeakMiB: Schema.Number,
  heapLimitMiB: Schema.Number,
  walPeakMiB: Schema.Number,
});
export type MemoryPeak = typeof MemoryPeak.Type;

const walBytes = (path: string): number => {
  try {
    return statSync(`${path}-wal`).size;
  } catch {
    return 0;
  }
};

export const startMemorySampler = (databasePath: string) => {
  const rssBaseline = process.memoryUsage().rss;
  let heapUsedPeak = 0;
  let heapTotalPeak = 0;
  let walPeak = 0;
  const sample = () => {
    walPeak = Math.max(walPeak, walBytes(databasePath));
    const heap = getHeapStatistics();
    heapUsedPeak = Math.max(heapUsedPeak, heap.used_heap_size);
    heapTotalPeak = Math.max(heapTotalPeak, heap.total_heap_size);
  };
  sample();
  const timer = setInterval(sample, 20);
  timer.unref();
  return {
    sample,
    stop: (): MemoryPeak => {
      sample();
      clearInterval(timer);
      return {
        rssMaxMiB: process.resourceUsage().maxRSS / 1024,
        rssBaselineMiB: rssBaseline / MIB,
        heapUsedPeakMiB: heapUsedPeak / MIB,
        heapTotalPeakMiB: heapTotalPeak / MIB,
        heapLimitMiB: getHeapStatistics().heap_size_limit / MIB,
        walPeakMiB: walPeak / MIB,
      };
    },
  };
};
