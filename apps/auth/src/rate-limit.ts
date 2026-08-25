export interface RateLimitAttempt {
  readonly key: string;
  readonly limit: number;
  readonly windowSeconds: number;
  readonly now: number;
}

export interface RateLimitWindow {
  readonly count: number;
  readonly expiresAt: number;
}

/**
 * In-memory counterpart of the D1 upsert in `AuthRepository.allowRateLimit`.
 * A `null` result is a denial and leaves the stored window unchanged.
 */
export const nextRateLimit = (
  current: RateLimitWindow | undefined,
  attempt: RateLimitAttempt,
): RateLimitWindow | null => {
  if (current === undefined || current.expiresAt <= attempt.now) {
    return { count: 1, expiresAt: attempt.now + attempt.windowSeconds * 1_000 };
  }
  if (current.count >= attempt.limit) return null;
  return { count: current.count + 1, expiresAt: current.expiresAt };
};
