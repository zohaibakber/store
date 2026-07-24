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

/** Compact "3h ago" style stamp for dense lists where a full date will not fit. */
export const formatRelativeTime = (value: number) => {
  const elapsed = value - Date.now();
  for (const [unit, size] of relativeUnits) {
    if (Math.abs(elapsed) >= size) return relative.format(Math.round(elapsed / size), unit);
  }
  return relative.format(Math.round(elapsed / 1000), "second");
};

// Invoice expiry dates arrive as day-first strings (see `InvoiceLine.expiresAt`
// in @store/services). `Date.parse` cannot be used here: it returns NaN for
// "31-12-2027" and, worse, silently reads "05-06-2027" as 5 June — a US
// month-first reading — so an ambiguous date would import as the wrong month
// rather than failing. Patterns are tried in order, day-first before ISO.
const expiryPatterns = ["dd-MM-yyyy", "dd/MM/yyyy", "yyyy-MM-dd"];

/**
 * Parses an invoice expiry date to a timestamp, or null when it is absent or
 * unreadable. Expiry drives FEFO batch ordering, so an unparseable date must
 * become null rather than an arbitrary one.
 */
export const parseExpiryDate = (value: string | null): number | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  for (const pattern of expiryPatterns) {
    const parsed = parse(trimmed, pattern, new Date());
    if (isValid(parsed)) return parsed.getTime();
  }
  return null;
};
