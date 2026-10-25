import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";

export type BackoffOptions = {
  readonly base: Duration.Duration;
  readonly max: Duration.Duration;
  readonly floor?: Duration.Duration;
};

export type Backoff = {
  readonly next: Effect.Effect<Duration.Duration>;
  readonly wait: Effect.Effect<void>;
  readonly reset: Effect.Effect<void>;
};

const backoffSchedule = (options: BackoffOptions): Schedule.Schedule<Duration.Duration> =>
  Schedule.min([Schedule.exponential(options.base), Schedule.spaced(options.max)]).pipe(
    Schedule.jittered,
    Schedule.modifyDelay(({ duration }) =>
      Effect.succeed(
        Duration.max(
          Duration.millis(Math.round(Duration.toMillis(duration))),
          options.floor ?? Duration.zero,
        ),
      ),
    ),
  );

const NEVER_FIRES: Backoff = {
  next: Effect.succeed(Duration.infinity),
  wait: Effect.never,
  reset: Effect.void,
};

export const makeBackoff = (options: BackoffOptions): Effect.Effect<Backoff> =>
  Effect.gen(function* () {
    if (!Duration.isFinite(options.base)) return NEVER_FIRES;
    const start = Schedule.toStep(backoffSchedule(options));
    const driver = yield* Ref.make(yield* start);
    const next = Effect.gen(function* () {
      const advance = yield* Ref.get(driver);
      const [, delay] = yield* advance(yield* Clock.currentTimeMillis, undefined);
      return delay;
    }).pipe(Effect.orElseSucceed(() => options.max));
    return {
      next,
      wait: Effect.flatMap(next, Effect.sleep),
      reset: Effect.flatMap(start, (fresh) => Ref.set(driver, fresh)),
    };
  });
