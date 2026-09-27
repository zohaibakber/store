import type { RuntimeContext } from "alchemy";
import type { RateLimitError } from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { authError } from "./errors";

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
