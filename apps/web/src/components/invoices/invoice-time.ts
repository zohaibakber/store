import { format, isSameDay, isSameYear, subDays } from "date-fns";

export const formatInvoiceTime = (value: number) => {
  const now = Date.now();
  const time = format(value, "h:mm a");
  if (isSameDay(value, now)) return `Today, ${time}`;
  if (isSameDay(value, subDays(now, 1))) return `Yesterday, ${time}`;
  return isSameYear(value, now) ? format(value, "d MMM, h:mm a") : format(value, "d MMM yyyy");
};
