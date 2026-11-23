const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How loudly an expiry date shows: red once expired or inside 30 days, amber
 * inside 90, otherwise muted. The cart and the batches table share it so a
 * batch reads the same at the counter and on its product.
 */
export const expiryTone = (expiresAt: number | null, now = Date.now()) => {
  if (expiresAt == null) return "text-muted-foreground";
  const days = (expiresAt - now) / DAY_MS;
  if (days <= 30) return "text-destructive-foreground";
  if (days <= 90) return "text-warning";
  return "text-muted-foreground";
};

/**
 * Days left once a batch is inside the 90-day window, so the warning never
 * rests on colour alone; null when it is further out or has no expiry.
 */
export const expiryDaysLeft = (expiresAt: number | null, now = Date.now()) => {
  if (expiresAt == null) return null;
  const days = Math.ceil((expiresAt - now) / DAY_MS);
  return days <= 90 ? days : null;
};
