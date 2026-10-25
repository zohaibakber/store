import type { RuntimeContext } from "alchemy";
import type { RateLimitError } from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NetAddress from "effect/net/NetAddress";
import * as Result from "effect/Result";

import { AuthRefusal, type RateLimitAttempt } from "./failures";

export const AUTH_RATE_LIMIT_PERIOD_SECONDS = 60;

export type AuthRateLimit = (
  key: string,
) => Effect.Effect<{ readonly success: boolean }, RateLimitError, RuntimeContext>;

export interface AuthLimits {
  readonly tenPerMinute: AuthRateLimit;
  readonly fivePerMinute: AuthRateLimit;
  readonly sixtyPerMinute: AuthRateLimit;
}

export const addressBucket = (address: string) => {
  if (!address.includes(":") || address.includes(".")) return address;
  return Result.match(NetAddress.ipv6FromString(address), {
    onFailure: () => address,
    onSuccess: (parsed) =>
      NetAddress.ipv6ToSegments(parsed)
        .slice(0, 4)
        .map((segment) => segment.toString(16))
        .join(":"),
  });
};

export class AuthLimiter extends Context.Service<
  AuthLimiter,
  {
    readonly admit: (
      bucket: keyof AuthLimits,
      key: string,
      attempting: RateLimitAttempt,
    ) => Effect.Effect<void, AuthRefusal, RuntimeContext>;
  }
>()("@store/auth-worker/AuthLimiter") {
  static readonly layer = (limits: AuthLimits) =>
    Layer.succeed(
      this,
      this.of({
        admit: Effect.fn("AuthLimiter.admit")(function* (bucket, key, attempting) {
          const decision = yield* limits[bucket](key).pipe(
            Effect.tapError((failure) =>
              Effect.logError("auth.limiter_unavailable").pipe(
                Effect.annotateLogs({ bucket, message: failure.message }),
              ),
            ),
            Effect.mapError(() => new AuthRefusal({ reason: "Unavailable" })),
          );
          if (!decision.success)
            return yield* new AuthRefusal({ reason: `RateLimited.${attempting}` });
        }),
      }),
    );
}
