import {
  REPLICA_PORT_ROLES,
  REPLICA_PORTS_CHANNEL,
  type ReplicaPortsMessage,
  type WorkerPhase,
  type WorkspaceState,
} from "@store/contracts/replica";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { MessageChannelMain, MessagePortMain } from "electron";

import { layerDesktopServer } from "./desktop-rpcs";
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
  readonly track: (
    worker: Worker,
    phases: Stream.Stream<WorkerPhase>,
  ) => Effect.Effect<void, never, Scope.Scope>;
  readonly reattach: Effect.Effect<void>;
};

type Attachment = {
  readonly workers: Scope.Closeable;
  readonly desktop: Scope.Closeable;
};

export const makeRendererPorts = (options: {
  readonly target: RendererPortsTarget;
  readonly workspaceToken: string;
  readonly channel: () => MessageChannelMain;
  readonly attachInsights: AttachPort;
}): Effect.Effect<RendererPorts, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const turn = yield* Semaphore.make(1);
    const generations = yield* Ref.make(0);
    const live = yield* Ref.make<Partial<Record<Worker, AttachPort>>>({});
    const attached = yield* Ref.make(Option.none<Attachment>());
    const state = yield* SubscriptionRef.make<WorkspaceState>({
      writer: "starting",
      reader: "starting",
    });

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
          onSome: (attachment) => Scope.close(attachment.workers, Exit.void),
        }),
      ),
    );

    const attach = Effect.gen(function* () {
      const { writer, reader } = yield* Ref.get(live);
      if (writer === undefined || reader === undefined || options.target.isDestroyed()) return;
      yield* closeWorkerPorts;
      const previous = yield* Ref.get(attached);
      const workers = yield* Scope.fork(scope);
      const desktop = yield* Scope.fork(scope);
      const reads = yield* bridge(reader).pipe(Scope.provide(workers));
      const store = yield* bridge(writer).pipe(Scope.provide(workers));
      const insights = yield* bridge(options.attachInsights).pipe(Scope.provide(workers));
      yield* Effect.all([reads.attach, store.attach], { discard: true, concurrency: 2 });
      yield* Effect.forkIn(insights.attach, workers);
      const desktopChannel = options.channel();
      yield* Layer.launch(
        Layer.fresh(layerDesktopServer(desktopChannel.port1, SubscriptionRef.changes(state))),
      ).pipe(Effect.ignoreCause, Effect.forkIn(desktop));
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
          [reads.port, store.port, desktopChannel.port2, insights.port],
        ),
      ).pipe(Effect.ignore);
      yield* Ref.set(attached, Option.some({ workers, desktop }));
      if (Option.isSome(previous)) yield* Scope.close(previous.value.desktop, Exit.void);
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
      track: (worker, phases) =>
        phases.pipe(
          Stream.runForEach((phase) =>
            SubscriptionRef.update(state, (current) => ({ ...current, [worker]: phase })),
          ),
          Effect.forkScoped,
          Effect.asVoid,
        ),
      reattach: Effect.forkIn(attach, scope).pipe(Effect.asVoid),
    };
  });

export const noRendererPorts: RendererPorts = {
  workerUp: () => Effect.void,
  track: () => Effect.void,
  reattach: Effect.void,
};
