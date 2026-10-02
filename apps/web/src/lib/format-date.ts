import { format, isValid, parse } from "date-fns";

export const formatDate = (value: number) => format(value, "d MMM yyyy");

export const formatDateTime = (value: number) => format(value, "d MMM yyyy, h:mm a");

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
