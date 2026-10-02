import type { AnalyticsStatus, StockStatusCounts } from "@store/contracts";
import type { DemandForecast, OrderSuggestion, StockStatus } from "@store/services/insights";

import { EMPTY, formatCount } from "@/lib/format";

export type Tone = "error" | "warning" | "info" | "success" | "secondary";

export const STATUS_META = {
  out: { label: "Out of stock", tone: "error", hint: "Selling product with nothing left" },
  critical: { label: "Running out", tone: "error", hint: "Runs out before a delivery arrives" },
  low: { label: "Reorder", tone: "warning", hint: "At or under the reorder point" },
  dead: { label: "Not selling", tone: "secondary", hint: "No sales for the dead-stock period" },
  overstock: { label: "Overstocked", tone: "info", hint: "Far more cover than needed" },
  healthy: { label: "Healthy", tone: "success", hint: "Stock covers expected demand" },
  inactive: { label: "Inactive", tone: "secondary", hint: "No stock and no recent sales" },
} satisfies Record<
  StockStatus,
  { readonly label: string; readonly tone: Tone; readonly hint: string }
>;

export const restockActionCount = (counts: StockStatusCounts) =>
  counts.out + counts.critical + counts.low;

export const HEALTH_ORDER: ReadonlyArray<StockStatus> = [
  "out",
  "critical",
  "low",
  "healthy",
  "overstock",
  "dead",
];

const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 0 });
const signedPercent = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
});

export const formatRate = (value: number) => decimal.format(value);
export const formatShare = (value: number) => percent.format(value);
export const formatChange = (value: number | null) =>
  value === null ? null : signedPercent.format(value);

const formatCover = (days: number | null) => {
  if (days === null) return EMPTY;
  if (days < 1) return "< 1 day";
  if (days > 365) return "1 yr+";
  return formatCount(Math.floor(days), "day");
};

export const formatStockCover = (insight: {
  readonly usableUnits: number;
  readonly daysOfCover: number | null;
}) => (insight.usableUnits <= 0 ? EMPTY : formatCover(insight.daysOfCover));

export const formatOrder = (order: OrderSuggestion) =>
  formatCount(order.quantity, order.unit === "packs" ? "pack" : "unit");

export const changeTone = (value: number | null): Tone =>
  value === null || Math.abs(value) < 0.005 ? "secondary" : value > 0 ? "success" : "error";

const METHOD_LABEL = {
  ses: "Exponential smoothing",
  sba: "Croston (SBA)",
  average: "Simple average",
  none: "No demand",
} satisfies Record<DemandForecast["method"], string>;

const PATTERN_LABEL = {
  smooth: "steady seller",
  erratic: "uneven order sizes",
  intermittent: "sells on some days",
  lumpy: "occasional large orders",
  sparse: "too few sales to model",
  none: "no sales yet",
} satisfies Record<DemandForecast["pattern"], string>;

export const describeDemand = (demand: DemandForecast) =>
  `${METHOD_LABEL[demand.method]} · ${PATTERN_LABEL[demand.pattern]} · ${demand.confidence} confidence`;

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const formatHour = (hour: number) =>
  new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(2000, 0, 1, hour));

export const progressPercent = (progress: AnalyticsStatus["progress"]) =>
  progress === null || progress.total === 0
    ? null
    : Math.min(100, Math.round((progress.done / progress.total) * 100));
