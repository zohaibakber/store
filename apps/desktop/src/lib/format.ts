import { format, isValid, parse } from "date-fns";

export const formatDate = (value: number) => format(value, "d MMM yyyy");

export const formatDateTime = (value: number) => format(value, "d MMM yyyy, h:mm a");

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });
const relativeUnits: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export const formatRelativeTime = (value: number) => {
  const elapsed = value - Date.now();
  for (const [unit, size] of relativeUnits) {
    if (Math.abs(elapsed) >= size) return relative.format(Math.round(elapsed / size), unit);
  }
  return relative.format(Math.round(elapsed / 1000), "second");
};

const dayFirstThenIsoExpiryPatterns = ["dd-MM-yyyy", "dd/MM/yyyy", "yyyy-MM-dd"] as const;

export const parseExpiryDate = (value: string | null): number | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  for (const pattern of dayFirstThenIsoExpiryPatterns) {
    const parsed = parse(trimmed, pattern, new Date());
    if (isValid(parsed)) return parsed.getTime();
  }
  return null;
};

export const EMPTY = "—";

const pluralRules = new Intl.PluralRules("en");
const countFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export const formatNumber = (value: number) => countFormat.format(value);

export const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  pluralRules.select(count) === "one" ? singular : plural;

export const formatCount = (count: number, singular: string, plural?: string) =>
  `${formatNumber(count)} ${pluralize(count, singular, plural)}`;
