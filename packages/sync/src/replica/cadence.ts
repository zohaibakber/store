export const DEFAULT_DIGEST_VERIFICATION_INTERVAL_MILLIS = 6 * 60 * 60_000;

export type DigestVerificationCadence = number | "never";

export const dueSince = (
  lastAtMillis: number | undefined,
  nowMillis: number,
  intervalMillis: number,
): boolean => lastAtMillis === undefined || nowMillis - lastAtMillis >= intervalMillis;
