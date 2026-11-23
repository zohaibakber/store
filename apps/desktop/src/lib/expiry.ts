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
