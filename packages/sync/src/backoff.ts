import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";

export type BackoffOptions = {
  readonly baseMillis: number;
  readonly maxMillis: number;
  readonly floorMillis?: number;
};

export type Backoff = {
  readonly next: Effect.Effect<Duration.Duration>;
  readonly wait: Effect.Effect<void>;
  readonly reset: Effect.Effect<void>;
};

const backoffSchedule = (options: BackoffOptions): Schedule.Schedule<Duration.Duration> =>
  Schedule.min([
    Schedule.exponential(Duration.millis(options.baseMillis)),
    Schedule.spaced(Duration.millis(options.maxMillis)),
  ]).pipe(
    Schedule.jittered,
    Schedule.modifyDelay(({ duration }) =>
      Effect.succeed(
        Duration.max(
          Duration.millis(Math.round(Duration.toMillis(duration))),
          Duration.millis(options.floorMillis ?? 0),
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
    if (!Number.isFinite(options.baseMillis)) return NEVER_FIRES;
    const start = Schedule.toStep(backoffSchedule(options));
    const driver = yield* Ref.make(yield* start);
    const next = Effect.gen(function* () {
      const advance = yield* Ref.get(driver);
      const [, delay] = yield* advance(yield* Clock.currentTimeMillis, undefined);
      return delay;
    }).pipe(Effect.orElseSucceed(() => Duration.millis(options.maxMillis)));
    return {
      next,
      wait: Effect.flatMap(next, Effect.sleep),
      reset: Effect.flatMap(start, (fresh) => Ref.set(driver, fresh)),
    };
  });
