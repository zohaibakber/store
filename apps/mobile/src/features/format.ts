const currency = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" });
const count = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });
const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const month = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" });
const time = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit" });

export const DAY_MS = 86_400_000;

export const formatPrice = (paisa: number | null) =>
  paisa === null ? "—" : currency.format(paisa / 100);

export const formatCount = (value: number) => count.format(value);

export const formatExpiry = (timestamp: number) => month.format(timestamp);

export const formatDateTime = (timestamp: number) =>
  `${day.format(timestamp)}, ${time.format(timestamp)}`;

export const formatSignedCount = (value: number) =>
  value > 0 ? `+${formatCount(value)}` : value < 0 ? `−${formatCount(-value)}` : "0";

export const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

export const appVersionLabel = (version: string | null, build: string | null) => {
  if (version === null) return "Unknown";
  return build === null ? version : `${version} (${build})`;
};
