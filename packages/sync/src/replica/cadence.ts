export const DEFAULT_DIGEST_VERIFICATION_INTERVAL_MILLIS = 6 * 60 * 60_000;

export const dueSince = (
  lastAtMillis: number | undefined,
  nowMillis: number,
  intervalMillis: number | "never",
): boolean =>
  intervalMillis === "never"
    ? lastAtMillis === undefined
    : lastAtMillis === undefined || nowMillis - lastAtMillis >= intervalMillis;
