import {
  NOTICE_BUFFER_CAPACITY,
  offerCoalescing,
  type ReplicaCommitNotice as ClientCommitNotice,
} from "@store/client-db";
import { SyncEntity } from "@store/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import type * as RpcClient from "effect/unstable/rpc/RpcClient";
import { RpcClientError } from "effect/unstable/rpc/RpcClientError";

import {
  AnalyticsWorkerFailure,
  type AnalyticsEvent,
  type AnalyticsWorkerBoot,
  type AnalyticsWorkerRpcs,
} from "./analytics-rpc";
import type { ReplicaCommitNotice } from "./replica-rpc";

type AnalyticsWorkerClient = RpcClient.FromGroup<typeof AnalyticsWorkerRpcs, RpcClientError>;

type AnalyticsWorkerProcess = {
  readonly client: AnalyticsWorkerClient;
  readonly lost: Effect.Effect<void>;
};

type AnalyticsWorkerLaunch = {
  readonly workerPath: string;
  readonly boot: typeof AnalyticsWorkerBoot.Type;
};

export type SpawnAnalyticsWorker = (
  launch: AnalyticsWorkerLaunch,
) => Effect.Effect<AnalyticsWorkerProcess, never, Scope.Scope>;

const ANALYTICS_POLICY = {
  bootTimeout: Duration.seconds(20),
  maxFailedStarts: 3,
  stableAfter: Duration.seconds(30),
  cooldown: Duration.minutes(2),
};

type LiveAnalyticsWorker = {
  readonly client: AnalyticsWorkerClient;
  readonly incarnation: number;
  readonly startedAt: number;
  readonly scope: Scope.Closeable;
  readonly lost: Effect.Effect<void>;
};

class AnalyticsStartFailed extends Schema.TaggedError<AnalyticsStartFailed>()(
  "AnalyticsStartFailed",
  { message: Schema.String },
) {}

export type AnalyticsController = {
  readonly use: <A, E, R>(
    work: (client: AnalyticsWorkerClient) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | AnalyticsWorkerFailure, R>;
  readonly notify: (notice: typeof ReplicaCommitNotice.Type) => Effect.Effect<void>;
};

class AnalyticsWorkerLost extends Schema.TaggedError<AnalyticsWorkerLost>()("AnalyticsWorkerLost", {
  message: Schema.String,
}) {}

const ANALYTICS_NOTICE_TOKEN = "analytics";

const isSyncEntity = Schema.is(SyncEntity);

const unavailable = (message: string) => new AnalyticsWorkerFailure({ message });

export const makeAnalyticsController = (options: {
  readonly spawn: SpawnAnalyticsWorker;
  readonly launch: AnalyticsWorkerLaunch;
  readonly onEvent: (event: AnalyticsEvent) => Effect.Effect<void>;
}): Effect.Effect<AnalyticsController, never, Scope.Scope> =>
  Effect.gen(function* () {
    const parent = yield* Effect.scope;
    const liveRef = yield* Ref.make<Option.Option<LiveAnalyticsWorker>>(Option.none());
    const failures = yield* Ref.make({ count: 0, at: 0 });
    const incarnations = yield* Ref.make(0);
    const turn = yield* Semaphore.make(1);

    const dropLive = (worker: LiveAnalyticsWorker) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(liveRef);
        if (Option.isSome(current) && current.value.incarnation === worker.incarnation) {
          yield* Ref.set(liveRef, Option.none());
        }
        yield* Scope.close(worker.scope, Exit.void);
      });

    const noteFailure = (worker: LiveAnalyticsWorker | undefined) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const quick =
          worker === undefined ||
          now - worker.startedAt < Duration.toMillis(ANALYTICS_POLICY.stableAfter);
        yield* Ref.update(failures, (current) => ({
          count: quick ? current.count + 1 : 1,
          at: now,
        }));
      });

    const boot = Effect.gen(function* () {
      const scope = yield* Scope.fork(parent, "sequential");
      const incarnation = yield* Ref.updateAndGet(incarnations, (count) => count + 1);
      const started = yield* Effect.gen(function* () {
        const process = yield* options.spawn(options.launch).pipe(Scope.provide(scope));
        yield* process.client.Ready().pipe(
          Effect.timeoutOption(ANALYTICS_POLICY.bootTimeout),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(new AnalyticsStartFailed({ message: "The worker did not boot." })),
              onSome: Effect.succeed,
            }),
          ),
          Effect.raceFirst(
            process.lost.pipe(
              Effect.andThen(
                Effect.fail(new AnalyticsStartFailed({ message: "The worker stopped booting." })),
              ),
            ),
          ),
          Effect.mapError((cause) =>
            cause._tag === "AnalyticsStartFailed"
              ? cause
              : new AnalyticsStartFailed({ message: cause.message }),
          ),
        );
        const startedAt = yield* Clock.currentTimeMillis;
        const live: LiveAnalyticsWorker = {
          client: process.client,
          incarnation,
          startedAt,
          scope,
          lost: process.lost,
        };
        yield* process.client.Changes().pipe(
          Stream.runForEach(options.onEvent),
          Effect.catchCause(() => Effect.void),
          Effect.forkIn(scope),
        );
        yield* process.lost.pipe(
          Effect.andThen(noteFailure(live)),
          Effect.andThen(dropLive(live)),
          Effect.forkIn(parent),
        );
        return live;
      }).pipe(
        Effect.tapError(() =>
          noteFailure(undefined).pipe(Effect.andThen(Scope.close(scope, Exit.void))),
        ),
      );
      yield* Ref.set(liveRef, Option.some(started));
      return started;
    });

    const acquire = turn.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(liveRef);
        if (Option.isSome(current)) return current.value;
        const recent = yield* Ref.get(failures);
        const now = yield* Clock.currentTimeMillis;
        const cooling =
          recent.count >= ANALYTICS_POLICY.maxFailedStarts &&
          now - recent.at < Duration.toMillis(ANALYTICS_POLICY.cooldown);
        if (cooling) {
          return yield* unavailable("The insights worker keeps stopping. It will retry shortly.");
        }
        if (recent.count >= ANALYTICS_POLICY.maxFailedStarts)
          yield* Ref.set(failures, { count: 0, at: 0 });
        return yield* boot.pipe(Effect.mapError((cause) => unavailable(cause.message)));
      }),
    );

    const attempt = <A, E, R>(work: (client: AnalyticsWorkerClient) => Effect.Effect<A, E, R>) =>
      acquire.pipe(
        Effect.flatMap((live) =>
          Effect.raceFirst(
            work(live.client),
            live.lost.pipe(
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
        Ref.get(liveRef).pipe(
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
      notify: (notice) =>
        Effect.sync(() =>
          offerCoalescing(notices, {
            ...notice,
            workspaceToken: ANALYTICS_NOTICE_TOKEN,
            touchedEntities: notice.touchedEntities.filter(isSyncEntity),
            overflowedEntities: notice.overflowedEntities?.filter(isSyncEntity),
          }),
        ),
    } satisfies AnalyticsController;
  });
