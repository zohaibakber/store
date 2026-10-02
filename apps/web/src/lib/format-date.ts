import { format, isSameDay, isSameYear, isValid, parse, subDays } from "date-fns";

export const formatDate = (value: number) => format(value, "d MMM yyyy");

export const formatDateTime = (value: number) => format(value, "d MMM yyyy, h:mm a");

export const formatInvoiceTime = (value: number) => {
  const now = Date.now();
  const time = format(value, "h:mm a");
  if (isSameDay(value, now)) return `Today, ${time}`;
  if (isSameDay(value, subDays(now, 1))) return `Yesterday, ${time}`;
  return isSameYear(value, now) ? format(value, "d MMM, h:mm a") : format(value, "d MMM yyyy");
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
