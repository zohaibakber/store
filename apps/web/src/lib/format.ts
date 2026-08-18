import { format, isValid, parse } from "date-fns";

const currency = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" });

// Prices are stored in the smallest currency unit (paisa).
export const formatPrice = (value: number | null) =>
  value == null ? "—" : currency.format(value / 100);

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

// Keep day-first patterns ahead of ISO; Date.parse is ambiguous here.
const expiryPatterns = ["dd-MM-yyyy", "dd/MM/yyyy", "yyyy-MM-dd"];

export const parseExpiryDate = (value: string | null): number | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  for (const pattern of expiryPatterns) {
    const parsed = parse(trimmed, pattern, new Date());
    if (isValid(parsed)) return parsed.getTime();
  }
  return null;
};

/** Up to two initials, for avatar fallbacks. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
