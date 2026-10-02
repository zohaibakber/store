import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type * as RpcClient from "effect/unstable/rpc/RpcClient";
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError";

import {
  ReplicaWorkerFailure,
  type ReplicaReaderBoot,
  type ReplicaReaderRpcs,
  type ReplicaWorkerBoot,
  type ReplicaWorkerRpcs,
} from "./replica-rpc";

export type ReplicaWorkerClient = RpcClient.FromGroup<typeof ReplicaWorkerRpcs, RpcClientError>;

export type ReplicaReaderClient = RpcClient.FromGroup<typeof ReplicaReaderRpcs, RpcClientError>;

type EngineClient = {
  readonly Engine: () => Effect.Effect<"sqlite" | "unavailable", { readonly message: string }>;
};

type SupervisedProcess<Client> = {
  readonly client: Client;
  readonly lost: Effect.Effect<void>;
  readonly terminate: Effect.Effect<void>;
};

type SupervisedLaunch<Boot> = {
  readonly workerPath: string;
  readonly boot: Boot;
};

type SpawnSupervisedWorker<Client, Boot> = (
  launch: SupervisedLaunch<Boot>,
) => Effect.Effect<SupervisedProcess<Client>, never, Scope.Scope>;

export type SpawnReplicaWorker = SpawnSupervisedWorker<
  ReplicaWorkerClient,
  typeof ReplicaWorkerBoot.Type
>;

export type SpawnReplicaReader = SpawnSupervisedWorker<
  ReplicaReaderClient,
  typeof ReplicaReaderBoot.Type
>;

type LiveWorker<Client> = SupervisedProcess<Client> & { readonly incarnation: number };

export type LiveReplicaWorker = LiveWorker<ReplicaWorkerClient>;

class ReplicaWorkerLost extends Schema.TaggedError<ReplicaWorkerLost>()("ReplicaWorkerLost", {
  message: Schema.String,
}) {}

class WorkerIncarnationFailed extends Schema.TaggedError<WorkerIncarnationFailed>()(
  "WorkerIncarnationFailed",
  { message: Schema.String },
) {}

type ReplicaSupervisorState<Client> =
  | { readonly _tag: "Starting" }
  | { readonly _tag: "Running"; readonly worker: LiveWorker<Client> }
  | { readonly _tag: "Recovering" }
  | { readonly _tag: "Exhausted" }
  | { readonly _tag: "Unavailable" };

export type ReplicaSupervisorPolicy = {
  readonly retryDelay: Duration.Input;
  readonly maxFailedAttempts: number;
  readonly stableAfter: Duration.Input;
  readonly bootTimeout: Duration.Input;
  readonly requestWait: Duration.Input;
};

export const DEFAULT_SUPERVISOR_POLICY: ReplicaSupervisorPolicy = {
  retryDelay: Duration.seconds(1),
  maxFailedAttempts: 3,
  stableAfter: Duration.seconds(10),
  bootTimeout: Duration.minutes(2),
  requestWait: Duration.seconds(10),
};

export type ReplicaSupervisor<Client = ReplicaWorkerClient> = {
  readonly engine: "sqlite" | "unavailable";
  readonly use: <A, E, R>(
    work: (worker: LiveWorker<Client>) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | ReplicaWorkerFailure | ReplicaWorkerLost, R>;
  readonly useIdempotent: <A, E, R>(
    work: (worker: LiveWorker<Client>) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | ReplicaWorkerFailure | ReplicaWorkerLost, R>;
  readonly retry: Effect.Effect<void>;
  readonly terminate: Effect.Effect<void>;
};

export const isWorkerLost = Predicate.or(
  Predicate.isTagged("ReplicaWorkerLost"),
  Predicate.isTagged("RpcClientError"),
);

const restarting = () =>
  new ReplicaWorkerFailure({ message: "The local database worker is restarting." });

const exhausted = () =>
  new ReplicaWorkerFailure({
    message: "The local database worker stopped repeatedly and needs a manual retry.",
  });

const unavailable = () =>
  new ReplicaWorkerFailure({ message: "The local database worker is unavailable." });

export const startReplicaSupervisor = <Client extends EngineClient, Boot>(options: {
  readonly spawn: SpawnSupervisedWorker<Client, Boot>;
  readonly launch: SupervisedLaunch<Boot>;
  readonly policy: ReplicaSupervisorPolicy;
  readonly attach: (
    worker: LiveWorker<Client>,
    recovered: boolean,
  ) => Effect.Effect<void, never, Scope.Scope>;
  readonly onExhausted: Effect.Effect<void>;
}): Effect.Effect<ReplicaSupervisor<Client>, ReplicaWorkerFailure, Scope.Scope> =>
  Effect.gen(function* () {
    const { policy } = options;
    const state = yield* SubscriptionRef.make<ReplicaSupervisorState<Client>>({ _tag: "Starting" });
    const incarnations = yield* Ref.make(0);
    const retryRequests = yield* Queue.dropping<void>(1);
    const first = yield* Deferred.make<"sqlite" | "unavailable", ReplicaWorkerFailure>();

    const departed = (worker: LiveWorker<Client>) =>
      SubscriptionRef.changes(state).pipe(
        Stream.filter(
          (current) =>
            current._tag !== "Running" || current.worker.incarnation !== worker.incarnation,
        ),
        Stream.runHead,
        Effect.asVoid,
      );

    const lostAsFailure = (worker: LiveWorker<Client>) =>
      worker.lost.pipe(
        Effect.andThen(departed(worker)),
        Effect.andThen(
          Effect.fail(new ReplicaWorkerLost({ message: "The local database worker stopped." })),
        ),
      );

    const incarnate = (recovered: boolean) =>
      Effect.scoped(
        Effect.gen(function* () {
          const incarnation = yield* Ref.updateAndGet(incarnations, (count) => count + 1);
          const process = yield* options.spawn(options.launch);
          const worker: LiveWorker<Client> = { ...process, incarnation };
          const engine = yield* process.client.Engine().pipe(
            Effect.mapError((cause) => new WorkerIncarnationFailed({ message: cause.message })),
            Effect.timeoutOption(policy.bootTimeout),
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(
                    new WorkerIncarnationFailed({ message: "The worker did not boot in time." }),
                  ),
                onSome: Effect.succeed,
              }),
            ),
            Effect.raceFirst(
              process.lost.pipe(
                Effect.andThen(
                  Effect.fail(
                    new WorkerIncarnationFailed({ message: "The worker stopped while booting." }),
                  ),
                ),
              ),
            ),
          );
          if (engine === "unavailable") {
            yield* Deferred.succeed(first, "unavailable");
            yield* SubscriptionRef.set(state, { _tag: "Unavailable" });
            return yield* new WorkerIncarnationFailed({
              message: "The replica engine is unavailable.",
            });
          }
          yield* options.attach(worker, recovered);
          yield* SubscriptionRef.set(state, { _tag: "Running", worker });
          yield* Deferred.succeed(first, "sqlite");
          const early = yield* Effect.timeoutOption(process.lost, policy.stableAfter);
          if (Option.isNone(early)) yield* process.lost;
          yield* SubscriptionRef.set(state, { _tag: "Recovering" });
          if (Option.isSome(early)) {
            return yield* new WorkerIncarnationFailed({
              message: "The worker stopped soon after it started.",
            });
          }
        }),
      );

    const awaitExhaustion = SubscriptionRef.set(state, { _tag: "Exhausted" }).pipe(
      Effect.andThen(options.onExhausted),
      Effect.andThen(Queue.take(retryRequests)),
      Effect.andThen(SubscriptionRef.set(state, { _tag: "Recovering" })),
    );

    const recovery = incarnate(true).pipe(
      Effect.retry({
        schedule: Schedule.spaced(policy.retryDelay).pipe(
          Schedule.upTo({ times: Math.max(0, policy.maxFailedAttempts - 1) }),
        ),
      }),
      Effect.catchTag("WorkerIncarnationFailed", () => awaitExhaustion),
      Effect.forever,
    );

    const supervise = Effect.gen(function* () {
      const initial = yield* incarnate(false).pipe(
        Effect.as("continue" as const),
        Effect.catchTag("WorkerIncarnationFailed", (failure) =>
          Effect.gen(function* () {
            if (yield* Deferred.isDone(first)) return "continue" as const;
            yield* Deferred.fail(first, new ReplicaWorkerFailure({ message: failure.message }));
            return "stop" as const;
          }),
        ),
      );
      if (initial === "stop") return;
      const current = yield* SubscriptionRef.get(state);
      if (current._tag === "Unavailable") return;
      yield* recovery;
    });

    yield* Effect.forkScoped(supervise);
    const engine = yield* Deferred.await(first);

    const settled = SubscriptionRef.changes(state).pipe(
      Stream.filter((current) => current._tag !== "Starting" && current._tag !== "Recovering"),
      Stream.runHead,
      Effect.timeoutOption(policy.requestWait),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(restarting()),
          onSome: Option.match({
            onNone: () => Effect.fail(restarting()),
            onSome: (current) =>
              current._tag === "Running"
                ? Effect.succeed(current.worker)
                : Effect.fail(current._tag === "Exhausted" ? exhausted() : unavailable()),
          }),
        }),
      ),
    );

    const use = <A, E, R>(
      work: (worker: LiveWorker<Client>) => Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | ReplicaWorkerFailure | ReplicaWorkerLost, R> =>
      Effect.flatMap(settled, (worker) =>
        Effect.raceFirst(
          work(worker).pipe(
            Effect.catchCause((cause): Effect.Effect<never, E | ReplicaWorkerLost> =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.fail(
                    new ReplicaWorkerLost({ message: "The local database worker stopped." }),
                  )
                : Effect.failCause(cause),
            ),
          ),
          lostAsFailure(worker),
        ),
      );

    return {
      engine,
      use,
      useIdempotent: (work) => use(work).pipe(Effect.retry({ times: 1, while: isWorkerLost })),
      retry: Effect.flatMap(SubscriptionRef.get(state), (current) =>
        current._tag === "Exhausted"
          ? Queue.offer(retryRequests, undefined)
          : Effect.succeed(false),
      ).pipe(Effect.asVoid),
      terminate: Effect.flatMap(SubscriptionRef.get(state), (current) =>
        current._tag === "Running" ? current.worker.terminate : Effect.void,
      ),
    } satisfies ReplicaSupervisor<Client>;
  });
