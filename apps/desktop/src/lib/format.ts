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

export const EMPTY = "—";

const pluralRules = new Intl.PluralRules("en");
const countFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export const formatNumber = (value: number) => countFormat.format(value);

export const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  pluralRules.select(count) === "one" ? singular : plural;

export const formatCount = (count: number, singular: string, plural?: string) =>
  `${formatNumber(count)} ${pluralize(count, singular, plural)}`;
