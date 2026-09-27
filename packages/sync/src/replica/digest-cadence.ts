export const DEFAULT_DIGEST_VERIFICATION_INTERVAL_MILLIS = 6 * 60 * 60_000;

export type DigestCadenceInput = {
  readonly believesCaughtUp: boolean;
  readonly lastVerifiedAtMillis: number | undefined;
  readonly nowMillis: number;
  readonly intervalMillis: number;
};

export const shouldRequestDigest = (input: DigestCadenceInput): boolean => {
  if (!input.believesCaughtUp) return false;
  if (input.lastVerifiedAtMillis === undefined) return true;
  return input.nowMillis - input.lastVerifiedAtMillis >= input.intervalMillis;
};
