export const THROTTLE_AFTER_ATTEMPTS = 5;

const FIRST_WINDOW_MILLIS = 30_000;

const LONGEST_WINDOW_MILLIS = 15 * 60_000;

export type AttemptCounters = {
  readonly failedAttempts: number;
  readonly lockedUntil: number;
};

export const NO_FAILED_ATTEMPTS: AttemptCounters = { failedAttempts: 0, lockedUntil: 0 };

export const throttleWindowMillis = (failedAttempts: number): number =>
  failedAttempts < THROTTLE_AFTER_ATTEMPTS
    ? 0
    : Math.min(
        FIRST_WINDOW_MILLIS * 2 ** (failedAttempts - THROTTLE_AFTER_ATTEMPTS),
        LONGEST_WINDOW_MILLIS,
      );

export const remainingThrottleMillis = (counters: AttemptCounters, now: number): number =>
  Math.max(0, counters.lockedUntil - now);

export const afterWrongAttempt = (counters: AttemptCounters, now: number) => {
  const failedAttempts = counters.failedAttempts + 1;
  const windowMillis = throttleWindowMillis(failedAttempts);
  return {
    counters: { failedAttempts, lockedUntil: windowMillis === 0 ? 0 : now + windowMillis },
    windowMillis,
  };
};
