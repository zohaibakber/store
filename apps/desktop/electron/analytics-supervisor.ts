import {
  NOTICE_BUFFER_CAPACITY,
  offerCoalescing,
  type ReplicaCommitNotice as ClientCommitNotice,
} from "@store/client-db";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as RcRef from "effect/RcRef";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type * as RpcClient from "effect/unstable/rpc/RpcClient";
import { RpcClientError } from "effect/unstable/rpc/RpcClientError";

import {
  analyticsNoticeOf,
  AnalyticsWorkerFailure,
  type AnalyticsEvent,
  type AnalyticsWorkerBoot,
  type AnalyticsWorkerRpcs,
} from "./analytics-rpc";
import type { ReplicaCommitNotice } from "./replica-rpc";
import { spawnNodeAnalyticsWorker } from "./worker-process";

type AnalyticsWorkerClient = RpcClient.FromGroup<typeof AnalyticsWorkerRpcs, RpcClientError>;

type AnalyticsWorkerProcess = {
  readonly client: AnalyticsWorkerClient;
  readonly lost: Effect.Effect<void>;
};

type LiveAnalyticsWorker = AnalyticsWorkerProcess & {
  readonly retired: Effect.Effect<void>;
};

type AnalyticsWorkerLaunch = {
  readonly workerPath: string;
  readonly boot: typeof AnalyticsWorkerBoot.Type;
};

const ANALYTICS_POLICY = {
  bootTimeout: Duration.seconds(20),
  maxFailedStarts: 3,
  stableAfter: Duration.seconds(30),
  cooldown: Duration.minutes(2),
};

export type AnalyticsController = {
  readonly use: <A, E, R>(
    work: (client: AnalyticsWorkerClient) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | AnalyticsWorkerFailure, R>;
  readonly notify: (notice: typeof ReplicaCommitNotice.Type) => Effect.Effect<void>;
};

class AnalyticsWorkerLost extends Schema.TaggedError<AnalyticsWorkerLost>()("AnalyticsWorkerLost", {
  message: Schema.String,
}) {}

const unavailable = (message: string) => new AnalyticsWorkerFailure({ message });

export const makeAnalyticsController = (options: {
  readonly launch: AnalyticsWorkerLaunch;
  readonly onEvent: (event: AnalyticsEvent) => Effect.Effect<void>;
}): Effect.Effect<AnalyticsController, never, Scope.Scope> =>
  Effect.gen(function* () {
    const parent = yield* Effect.scope;
    const failures = yield* Ref.make({ count: 0, at: 0 });
    const warm = yield* Ref.make<Option.Option<AnalyticsWorkerProcess>>(Option.none());

    const noteFailure = (startedAt: number | undefined) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const quick =
          startedAt === undefined ||
          now - startedAt < Duration.toMillis(ANALYTICS_POLICY.stableAfter);
        yield* Ref.update(failures, (current) => ({
          count: quick ? current.count + 1 : 1,
          at: now,
        }));
      });

    const boot: Effect.Effect<LiveAnalyticsWorker, AnalyticsWorkerFailure, Scope.Scope> =
      Effect.gen(function* () {
        const recent = yield* Ref.get(failures);
        const now = yield* Clock.currentTimeMillis;
        if (recent.count >= ANALYTICS_POLICY.maxFailedStarts) {
          if (now - recent.at < Duration.toMillis(ANALYTICS_POLICY.cooldown)) {
            return yield* unavailable("The insights worker keeps stopping. It will retry shortly.");
          }
          yield* Ref.set(failures, { count: 0, at: 0 });
        }
        const process = yield* spawnNodeAnalyticsWorker(options.launch);
        yield* process.client.Ready().pipe(
          Effect.timeoutOption(ANALYTICS_POLICY.bootTimeout),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(unavailable("The worker did not boot.")),
              onSome: Effect.succeed,
            }),
          ),
          Effect.raceFirst(
            process.lost.pipe(
              Effect.andThen(Effect.fail(unavailable("The worker stopped booting."))),
            ),
          ),
          Effect.mapError((cause) => unavailable(cause.message)),
          Effect.tapError(() => noteFailure(undefined)),
        );
        const startedAt = yield* Clock.currentTimeMillis;
        yield* process.client.Changes().pipe(
          Stream.runForEach(options.onEvent),
          Effect.catchCause(() => Effect.void),
          Effect.forkScoped,
        );
        yield* Ref.set(warm, Option.some(process));
        const retired = yield* Deferred.make<void>();
        yield* Effect.addFinalizer(() => Deferred.succeed(retired, undefined));
        yield* process.lost.pipe(
          Effect.andThen(noteFailure(startedAt)),
          Effect.andThen(Ref.set(warm, Option.none())),
          Effect.andThen(RcRef.invalidate(worker)),
          Effect.andThen(Deferred.succeed(retired, undefined)),
          Effect.forkIn(parent),
        );
        return { ...process, retired: Deferred.await(retired) };
      });

    const worker = yield* RcRef.make({ acquire: boot, idleTimeToLive: Duration.infinity });

    const attempt = <A, E, R>(work: (client: AnalyticsWorkerClient) => Effect.Effect<A, E, R>) =>
      Effect.scoped(
        Effect.flatMap(RcRef.get(worker), (live) =>
          Effect.raceFirst(
            work(live.client),
            live.retired.pipe(
              Effect.andThen(
                Effect.fail(new AnalyticsWorkerLost({ message: "The insights worker stopped." })),
              ),
            ),
          ),
        ),
      );

    const notices = yield* Queue.bounded<ClientCommitNotice>(NOTICE_BUFFER_CAPACITY);
    yield* Queue.take(notices).pipe(
      Effect.flatMap((notice) =>
        Ref.get(warm).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: (live) => live.client.Notify({ notice }).pipe(Effect.ignore),
            }),
          ),
        ),
      ),
      Effect.forever,
      Effect.forkScoped,
    );

    return {
      use: (work) =>
        attempt(work).pipe(
          Effect.retry({
            times: 1,
            while: (error) =>
              error instanceof AnalyticsWorkerLost || error instanceof RpcClientError,
          }),
          Effect.mapError((error) =>
            error instanceof AnalyticsWorkerLost || error instanceof RpcClientError
              ? unavailable(error.message)
              : error,
          ),
        ),
      notify: (notice) => Effect.sync(() => offerCoalescing(notices, analyticsNoticeOf(notice))),
    } satisfies AnalyticsController;
  });
