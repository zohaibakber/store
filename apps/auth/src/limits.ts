import type { RuntimeContext } from "alchemy";
import type { RateLimitError } from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { RateLimited } from "./failures";

export const AUTH_RATE_LIMIT_PERIOD_SECONDS = 60;

export type AuthRateLimit = (
  key: string,
) => Effect.Effect<{ readonly success: boolean }, RateLimitError, RuntimeContext>;

export interface AuthLimits {
  readonly tenPerMinute: AuthRateLimit;
  readonly fivePerMinute: AuthRateLimit;
}

interface AuthLimiterApi {
  readonly admit: (
    bucket: keyof AuthLimits,
    key: string,
    attempting: RateLimited["attempting"],
  ) => Effect.Effect<void, RateLimited, RuntimeContext>;
}

export class AuthLimiter extends Context.Service<AuthLimiter, AuthLimiterApi>()(
  "@store/auth-worker/AuthLimiter",
) {}

export const authLimiterLayer = (limits: AuthLimits) =>
  Layer.succeed(
    AuthLimiter,
    AuthLimiter.of({
      admit: Effect.fn("AuthLimiter.admit")(function* (bucket, key, attempting) {
        const decision = yield* limits[bucket](key).pipe(
          Effect.tapError((failure) =>
            Effect.logError("auth.limiter_unavailable").pipe(
              Effect.annotateLogs({ bucket, message: failure.message }),
            ),
          ),
          Effect.orDie,
        );
        if (!decision.success) return yield* new RateLimited({ attempting });
      }),
    }),
  );
