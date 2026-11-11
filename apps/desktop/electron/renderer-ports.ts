import {
  REPLICA_PORT_ROLES,
  REPLICA_PORTS_CHANNEL,
  type ReplicaPortsMessage,
  type WorkspaceToken,
} from "@store/contracts/replica";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import type { MessageChannelMain, MessagePortMain } from "electron";

import { pumpPorts } from "./port-pump";

const ATTACH_LIMIT = "10 seconds";

type AttachPort = (port: MessagePort) => Effect.Effect<void, unknown>;

type Worker = "writer" | "reader";

export type RendererPortsTarget = {
  readonly isDestroyed: () => boolean;
  readonly postMessage: (
    channel: string,
    message: ReplicaPortsMessage,
    transfer: Array<MessagePortMain>,
  ) => void;
};

export type RendererPorts = {
  readonly workerUp: (
    worker: Worker,
    attach: AttachPort,
  ) => Effect.Effect<void, never, Scope.Scope>;
  readonly reattach: Effect.Effect<void>;
};

export const makeRendererPorts = (options: {
  readonly target: RendererPortsTarget;
  readonly workspaceToken: WorkspaceToken;
  readonly channel: () => MessageChannelMain;
  readonly attachInsights: AttachPort;
}): Effect.Effect<RendererPorts, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const turn = yield* Semaphore.make(1);
    const generations = yield* Ref.make(0);
    const live = yield* Ref.make<Partial<Record<Worker, AttachPort>>>({});
    const attached = yield* Ref.make(Option.none<Scope.Closeable>());

    const bridge = (attach: AttachPort) =>
      Effect.gen(function* () {
        const worker = new MessageChannel();
        const renderer = options.channel();
        yield* pumpPorts(renderer.port1, worker.port2);
        return {
          port: renderer.port2,
          attach: attach(worker.port1).pipe(
            Effect.timeout(ATTACH_LIMIT),
            Effect.catchCause((cause) =>
              Effect.logWarning("RendererPorts.attach_failed", cause).pipe(
                Effect.andThen(Effect.sync(() => renderer.port1.close())),
              ),
            ),
          ),
        };
      });

    const closeWorkerPorts = Ref.get(attached).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (workers) => Scope.close(workers, Exit.void),
        }),
      ),
    );

    const attach = Effect.gen(function* () {
      const { writer, reader } = yield* Ref.get(live);
      if (writer === undefined || reader === undefined || options.target.isDestroyed()) return;
      yield* closeWorkerPorts;
      const workers = yield* Scope.fork(scope);
      const reads = yield* bridge(reader).pipe(Scope.provide(workers));
      const store = yield* bridge(writer).pipe(Scope.provide(workers));
      const insights = yield* bridge(options.attachInsights).pipe(Scope.provide(workers));
      yield* Effect.all([reads.attach, store.attach], { discard: true, concurrency: 2 });
      yield* Effect.forkIn(insights.attach, workers);
      const generation = yield* Ref.updateAndGet(generations, (count) => count + 1);
      yield* Effect.try(() =>
        options.target.postMessage(
          REPLICA_PORTS_CHANNEL,
          {
            type: REPLICA_PORTS_CHANNEL,
            generation,
            workspaceToken: options.workspaceToken,
            roles: REPLICA_PORT_ROLES,
          },
          [reads.port, store.port, insights.port],
        ),
      ).pipe(Effect.catch((error) => Effect.logWarning("RendererPorts.post_failed", error)));
      yield* Ref.set(attached, Option.some(workers));
    }).pipe(turn.withPermits(1));

    return {
      workerUp: (worker, attachPort) =>
        Effect.acquireRelease(
          Ref.update(live, (current) => ({ ...current, [worker]: attachPort })),
          () =>
            Ref.update(live, ({ [worker]: _gone, ...rest }) => rest).pipe(
              Effect.andThen(turn.withPermits(1)(closeWorkerPorts)),
            ),
        ).pipe(Effect.andThen(Effect.forkIn(attach, scope)), Effect.asVoid),
      reattach: Effect.forkIn(attach, scope).pipe(Effect.asVoid),
    };
  });

export const noRendererPorts: RendererPorts = {
  workerUp: () => Effect.void,
  reattach: Effect.void,
};
