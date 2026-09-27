import type { RuntimeContext } from "alchemy";
import type { RateLimitError } from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { authError } from "./errors";

/**
 * Window of both auth rate limiters, in seconds. A limited caller is told to
 * retry after this long.
 */
export const AUTH_RATE_LIMIT_PERIOD_SECONDS = 60;

export type AuthRateLimit = (
  key: string,
) => Effect.Effect<{ readonly success: boolean }, RateLimitError, RuntimeContext>;

export interface AuthLimits {
  readonly tenPerMinute: AuthRateLimit;
  readonly fivePerMinute: AuthRateLimit;
}

export const enforceAuthLimit = (limit: AuthRateLimit, key: string, message: string) =>
  Effect.gen(function* () {
    const decision = yield* limit(key).pipe(Effect.orDie);
    if (!decision.success) return yield* authError(429, "RATE_LIMITED", message);
  });
