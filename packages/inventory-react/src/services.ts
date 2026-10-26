import * as BrowserWorker from "@effect/platform-browser/BrowserWorker";
import {
  DesktopRpcs,
  INSIGHTS_KEY,
  InventoryInsights,
  InventoryReads,
  InventoryStore,
  ReplicaPortsMessage,
  ReplicaUnavailable,
  type ReplicaPortRole,
  type ReplicaUnavailableReason,
  type Stamp,
  type SyncHealth,
  type WorkerPhase,
  type WorkspaceState,
} from "@store/contracts/replica";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as AtomRpc from "effect/reactivity/AtomRpc";
import * as Reactivity from "effect/reactivity/Reactivity";
import type * as Rpc from "effect/rpc/Rpc";
import * as RpcClient from "effect/rpc/RpcClient";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

type WorkerPorts = {
  readonly generation: number;
  readonly reads: MessagePort;
  readonly store: MessagePort;
  readonly insights: MessagePort;
};

const desktopPort = Atom.make(Option.none<MessagePort>()).pipe(Atom.keepAlive);

export type ForwardedPorts = {
  readonly message: ReplicaPortsMessage;
  readonly ports: ReadonlyArray<MessagePort>;
};

const decodePortsMessage = Schema.decodeUnknownOption(ReplicaPortsMessage);

export const forwardedPorts = (source: Window): Stream.Stream<ForwardedPorts> =>
  Stream.fromEventListener<MessageEvent>(source, "message").pipe(
    Stream.filter((event) => event.source === source),
    Stream.flatMap((event) =>
      Option.match(decodePortsMessage(event.data), {
        onNone: () => Stream.empty,
        onSome: (message) => Stream.succeed({ message, ports: event.ports }),
      }),
    ),
  );

const whenClosed = (port: MessagePort, clear: () => void) => {
  port.addEventListener("close", clear, { once: true });
};

const deliverPorts = (
  registry: AtomRegistry.AtomRegistry,
  workerPorts: Atom.Writable<Option.Option<WorkerPorts>>,
  { message, ports }: ForwardedPorts,
): void => {
  const portOf = (role: ReplicaPortRole) => ports[message.roles.indexOf(role)];
  const reads = portOf("reads");
  const store = portOf("store");
  const insights = portOf("insights");
  const desktop = portOf("desktop");
  if (reads === undefined || store === undefined || insights === undefined) return;
  const generation = message.generation;
  for (const port of [reads, store, insights]) {
    whenClosed(port, () =>
      registry.update(workerPorts, (current) =>
        Option.exists(current, (held) => held.reads === reads) ? Option.none() : current,
      ),
    );
  }
  registry.set(workerPorts, Option.some({ generation, reads, store, insights }));
  if (desktop === undefined) return;
  whenClosed(desktop, () =>
    registry.update(desktopPort, (current) =>
      Option.contains(current, desktop) ? Option.none() : current,
    ),
  );
  registry.set(desktopPort, Option.some(desktop));
};

const latest = <A>(source: Atom.Atom<Option.Option<A>>): Atom.Atom<Option.Option<A>> =>
  Atom.make((get) =>
    Option.orElse(get(source), () => Option.flatten(get.self<Option.Option<A>>())),
  );

const latestDesktop = latest(desktopPort);

const overPort = (port: Option.Option<MessagePort>) =>
  Option.match(port, {
    onNone: () => Layer.effect(RpcClient.Protocol, Effect.never),
    onSome: (open) =>
      RpcClient.layerProtocolWorker({ size: 1, concurrency: 16 }).pipe(
        Layer.provide(BrowserWorker.layer(() => open)),
      ),
  });

type Client<Rpcs extends Rpc.Any> = RpcClient.RpcClient.Flat<Rpcs, RpcClientError>;

const CLIENT_LINGER = "10 seconds";

const outlivingItsRuntime = Effect.fn("InventoryServices.outlivingItsRuntime")(function* <A, R>(
  make: Effect.Effect<A, never, R>,
) {
  const own = yield* Scope.make();
  yield* Effect.addFinalizer(() =>
    Scope.close(own, Exit.void).pipe(Effect.delay(CLIENT_LINGER), Effect.forkDetach),
  );
  return yield* Scope.provide(make, own);
});

export interface Reads {
  readonly Reads: unique symbol;
}

export interface Store {
  readonly Store: unique symbol;
}

export interface Insights {
  readonly Insights: unique symbol;
}

type ReadsRpcs = RpcGroup.Rpcs<typeof InventoryReads>;
type StoreRpcs = RpcGroup.Rpcs<typeof InventoryStore>;
type InsightsRpcs = RpcGroup.Rpcs<typeof InventoryInsights>;

export type InventoryServices = {
  readonly Reads: AtomRpc.AtomRpcClient<Reads, "inventory/Reads", ReadsRpcs>;
  readonly Store: AtomRpc.AtomRpcClient<Store, "inventory/Store", StoreRpcs>;
  readonly Insights: AtomRpc.AtomRpcClient<Insights, "inventory/Insights", InsightsRpcs>;
  readonly generation: Atom.Atom<Option.Option<number>>;
  readonly workspace: Atom.Atom<Option.Option<WorkspaceState>>;
};

export class Desktop extends AtomRpc.Service<Desktop>()("desktop/Rpcs", {
  group: DesktopRpcs,
  runtime: Atom.runtime,
  protocol: (get) => overPort(get(latestDesktop)),
}) {}

const desktopWorkspace = Desktop.runtime.atom(
  Stream.unwrap(Desktop.use((desktop) => Effect.succeed(desktop("WorkspaceState", undefined)))),
);

export const openReplicaChannel = Effect.fn("InventoryServices.openReplicaChannel")(function* (
  registry: AtomRegistry.AtomRegistry,
) {
  const workerPorts = Atom.make(Option.none<WorkerPorts>());
  yield* AtomRegistry.mount(registry, workerPorts);
  const latestWorkers = latest(workerPorts);
  const workerProtocol = (role: "reads" | "store" | "insights") => (get: Atom.AtomContext) =>
    overPort(Option.map(get(latestWorkers), (ports) => ports[role]));
  const services: InventoryServices = {
    Reads: AtomRpc.Service<Reads>()("inventory/Reads", {
      group: InventoryReads,
      runtime: Atom.runtime,
      protocol: workerProtocol("reads"),
      makeEffect: outlivingItsRuntime(RpcClient.make(InventoryReads, { flatten: true })),
    }),
    Store: AtomRpc.Service<Store>()("inventory/Store", {
      group: InventoryStore,
      runtime: Atom.runtime,
      protocol: workerProtocol("store"),
      makeEffect: outlivingItsRuntime(RpcClient.make(InventoryStore, { flatten: true })),
    }),
    Insights: AtomRpc.Service<Insights>()("inventory/Insights", {
      group: InventoryInsights,
      runtime: Atom.runtime,
      protocol: workerProtocol("insights"),
      makeEffect: outlivingItsRuntime(RpcClient.make(InventoryInsights, { flatten: true })),
    }),
    generation: Atom.map(workerPorts, (ports) => Option.map(ports, (held) => held.generation)),
    workspace: Atom.map(desktopWorkspace, AsyncResult.value),
  };
  return {
    services,
    deliver: (forwarded: ForwardedPorts) => deliverPorts(registry, workerPorts, forwarded),
  };
});

export type StoreClient = Client<StoreRpcs>;

const restarting = () => new ReplicaUnavailable({ reason: "restarting" });

const unavailableReason = (
  generation: Option.Option<number>,
  workspace: Option.Option<WorkspaceState>,
): Option.Option<ReplicaUnavailableReason> => {
  const phases = Option.match(workspace, {
    onNone: (): ReadonlyArray<WorkerPhase> => [],
    onSome: (state) => [state.writer, state.reader],
  });
  if (phases.includes("exhausted")) return Option.some("exhausted");
  if (phases.includes("unavailable")) return Option.some("closed");
  if (phases.includes("recovering") || phases.includes("starting") || Option.isNone(generation)) {
    return Option.some("restarting");
  }
  return Option.none();
};

const WAKE_WAIT = "5 seconds";

const RUNNING_HEALTH: SyncHealth = { _tag: "running" };

export type InventoryLinks = ReturnType<typeof makeInventoryLinks>;

export const makeInventoryLinks = (services: InventoryServices) => {
  const { Store: StoreService, Insights: InsightsService } = services;
  const commitTick = Atom.make(0).pipe(Atom.setIdleTTL(0));
  const lastStamp = Atom.make(Option.none<Stamp>()).pipe(Atom.setIdleTTL(0));

  const commits = StoreService.runtime
    .atom((get) =>
      Effect.gen(function* () {
        const store = yield* StoreService;
        const reactivity = yield* Reactivity.Reactivity;
        const registry = yield* AtomRegistry.AtomRegistry;
        const after = get.once(lastStamp);
        yield* store("Commits", Option.isSome(after) ? { after: after.value } : {}).pipe(
          Stream.runForEach((notice) =>
            Effect.sync(() => {
              Atom.batch(() => {
                registry.set(lastStamp, Option.some(notice.stamp));
                registry.update(commitTick, (count) => count + 1);
              });
              reactivity.invalidateUnsafe(notice.touchedKeys);
            }),
          ),
        );
      }),
    )
    .pipe(Atom.setIdleTTL(0));

  const syncHealth = StoreService.runtime
    .atom(Stream.unwrap(StoreService.use((store) => Effect.succeed(store("Health", undefined)))))
    .pipe(Atom.setIdleTTL(0));

  const staffState = StoreService.runtime
    .atom(
      Stream.unwrap(StoreService.use((store) => Effect.succeed(store("StaffState", undefined)))),
    )
    .pipe(Atom.setIdleTTL(0));

  const staff = Atom.make((get) => AsyncResult.value(get(staffState)));

  const unavailable = Atom.make((get) =>
    unavailableReason(get(services.generation), get(services.workspace)),
  );

  const sync = Atom.make((get) => AsyncResult.getOrElse(get(syncHealth), () => RUNNING_HEALTH));

  const healthTag = Atom.map(sync, (current) =>
    current._tag === "running" ? current._tag : `${current._tag}:${current.message}`,
  );

  const health = Atom.make((get) => ({ sync: get(sync), unavailable: get(unavailable) }));

  const insightChanges = InsightsService.runtime
    .atom(
      Effect.gen(function* () {
        const insights = yield* InsightsService;
        const reactivity = yield* Reactivity.Reactivity;
        yield* insights("Changes", undefined).pipe(
          Stream.runForEach(() => Effect.sync(() => reactivity.invalidateUnsafe([INSIGHTS_KEY]))),
        );
      }),
    )
    .pipe(Atom.setIdleTTL(0));

  const generationMoved = (registry: AtomRegistry.AtomRegistry, started: number) =>
    AtomRegistry.toStream(registry, services.generation).pipe(
      Stream.filter((current) => !Option.contains(current, started)),
      Stream.runHead,
      Effect.andThen(Effect.fail(restarting())),
    );

  const withStore = <A, E>(
    registry: AtomRegistry.AtomRegistry,
    use: (store: StoreClient) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E> =>
    AtomRegistry.mount(registry, StoreService.runtime).pipe(
      Effect.andThen(
        AtomRegistry.getResult(registry, StoreService.runtime, { suspendOnWaiting: true }),
      ),
      Effect.flatMap((context) => use(Context.get(context, StoreService))),
      Effect.scoped,
    );

  const command = <A, E>(
    registry: AtomRegistry.AtomRegistry,
    send: (store: StoreClient) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E | ReplicaUnavailable> =>
    Effect.suspend(() => {
      const started = registry.get(services.generation);
      if (Option.isNone(started)) {
        return Effect.fail(
          new ReplicaUnavailable({
            reason: Option.getOrElse(registry.get(unavailable), () => "restarting" as const),
          }),
        );
      }
      return Effect.raceFirst(withStore(registry, send), generationMoved(registry, started.value));
    });

  const wake = (registry: AtomRegistry.AtomRegistry): Effect.Effect<void> =>
    withStore(registry, (store) => store("WakeSyncUpload", undefined)).pipe(
      Effect.timeout(WAKE_WAIT),
      Effect.ignore,
    );

  const retained: ReadonlyArray<Atom.Atom<unknown>> = [
    commitTick,
    lastStamp,
    commits,
    syncHealth,
    staffState,
    insightChanges,
  ];

  return {
    wake,
    retained,
    commitTick,
    sync,
    healthTag,
    unavailable,
    health,
    staff,
    command,
  };
};
