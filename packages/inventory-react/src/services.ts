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

export const runtime = Atom.context();

export type WorkerPorts = {
  readonly generation: number;
  readonly reads: MessagePort;
  readonly store: MessagePort;
  readonly insights: MessagePort;
};

export type DesktopPort = {
  readonly generation: number;
  readonly port: MessagePort;
};

export type ReplicaPorts = {
  readonly workers: Option.Option<WorkerPorts>;
  readonly desktop: Option.Option<DesktopPort>;
};

const NO_PORTS: ReplicaPorts = { workers: Option.none(), desktop: Option.none() };

export const Ports = Atom.make<ReplicaPorts>(NO_PORTS).pipe(Atom.keepAlive);

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

export const deliverPorts = (
  registry: AtomRegistry.AtomRegistry,
  { message, ports }: ForwardedPorts,
): void => {
  const portOf = (role: ReplicaPortRole) => ports[message.roles.indexOf(role)];
  const reads = portOf("reads");
  const store = portOf("store");
  const insights = portOf("insights");
  const desktop = portOf("desktop");
  if (reads === undefined || store === undefined || insights === undefined) return;
  const generation = message.generation;
  const clearWorkers = () =>
    registry.update(Ports, (current) =>
      Option.exists(current.workers, (held) => held.generation === generation)
        ? { ...current, workers: Option.none() }
        : current,
    );
  const clearDesktop = () =>
    registry.update(Ports, (current) =>
      Option.exists(current.desktop, (held) => held.generation === generation)
        ? { ...current, desktop: Option.none() }
        : current,
    );
  for (const port of [reads, store, insights]) whenClosed(port, clearWorkers);
  if (desktop !== undefined) whenClosed(desktop, clearDesktop);
  registry.set(Ports, {
    workers: Option.some({ generation, reads, store, insights }),
    desktop:
      desktop === undefined
        ? registry.get(Ports).desktop
        : Option.some({ generation, port: desktop }),
  });
};

const latest = <A>(source: Atom.Atom<Option.Option<A>>): Atom.Atom<Option.Option<A>> =>
  Atom.make((get) =>
    Option.orElse(get(source), () => Option.flatten(get.self<Option.Option<A>>())),
  );

const latestWorkers = latest(Atom.map(Ports, (ports) => ports.workers));
const latestDesktop = latest(Atom.map(Ports, (ports) => ports.desktop));

const overPort = (port: Option.Option<MessagePort>) =>
  Option.match(port, {
    onNone: () => Layer.effect(RpcClient.Protocol, Effect.never),
    onSome: (open) =>
      RpcClient.layerProtocolWorker({ size: 1, concurrency: 16 }).pipe(
        Layer.provide(BrowserWorker.layer(() => open)),
      ),
  });

const workerProtocol = (role: "reads" | "store" | "insights") => (get: Atom.AtomContext) =>
  overPort(Option.map(get(latestWorkers), (ports) => ports[role]));

type Client<Rpcs extends Rpc.Any> = RpcClient.RpcClient.Flat<Rpcs, RpcClientError>;

export type Link<Rpcs extends Rpc.Any, R, E> = {
  readonly protocol: (get: Atom.AtomContext) => Layer.Layer<Exclude<R, Scope.Scope>, E>;
  readonly makeEffect: Effect.Effect<Client<Rpcs>, never, R>;
};

const CLIENT_LINGER = "10 seconds";

const outlivingItsRuntime = <A, R>(
  make: Effect.Effect<A, never, R>,
): Effect.Effect<A, never, Exclude<R, Scope.Scope> | Scope.Scope> =>
  Effect.gen(function* () {
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

const RUNNING: WorkspaceState = { writer: "running", reader: "running" };

export type InventoryServices = {
  readonly Reads: AtomRpc.AtomRpcClient<Reads, "inventory/Reads", ReadsRpcs>;
  readonly Store: AtomRpc.AtomRpcClient<Store, "inventory/Store", StoreRpcs>;
  readonly Insights: AtomRpc.AtomRpcClient<Insights, "inventory/Insights", InsightsRpcs>;
  readonly generation: Atom.Atom<Option.Option<number>>;
  readonly workspace: Atom.Atom<Option.Option<WorkspaceState>>;
};

export const makeInventoryServices = <R1, E1, R2, E2, R3, E3>(links: {
  readonly reads: Link<ReadsRpcs, R1, E1>;
  readonly store: Link<StoreRpcs, R2, E2>;
  readonly insights: Link<InsightsRpcs, R3, E3>;
  readonly generation: Atom.Atom<Option.Option<number>>;
  readonly workspace: Atom.Atom<Option.Option<WorkspaceState>>;
}): InventoryServices => ({
  Reads: AtomRpc.Service<Reads>()("inventory/Reads", {
    group: InventoryReads,
    runtime,
    ...links.reads,
  }),
  Store: AtomRpc.Service<Store>()("inventory/Store", {
    group: InventoryStore,
    runtime,
    ...links.store,
  }),
  Insights: AtomRpc.Service<Insights>()("inventory/Insights", {
    group: InventoryInsights,
    runtime,
    ...links.insights,
  }),
  generation: links.generation,
  workspace: links.workspace,
});

export class Desktop extends AtomRpc.Service<Desktop>()("desktop/Rpcs", {
  group: DesktopRpcs,
  runtime,
  protocol: (get) => overPort(Option.map(get(latestDesktop), (desktop) => desktop.port)),
}) {}

const desktopWorkspace = Desktop.runtime.atom(
  Stream.unwrap(Desktop.use((desktop) => Effect.succeed(desktop("WorkspaceState", undefined)))),
);

export const desktopServices = makeInventoryServices({
  reads: {
    protocol: workerProtocol("reads"),
    makeEffect: outlivingItsRuntime(RpcClient.make(InventoryReads, { flatten: true })),
  },
  store: {
    protocol: workerProtocol("store"),
    makeEffect: outlivingItsRuntime(RpcClient.make(InventoryStore, { flatten: true })),
  },
  insights: {
    protocol: workerProtocol("insights"),
    makeEffect: outlivingItsRuntime(RpcClient.make(InventoryInsights, { flatten: true })),
  },
  generation: Atom.map(Ports, (ports) => Option.map(ports.workers, (held) => held.generation)),
  workspace: Atom.map(desktopWorkspace, AsyncResult.value),
});

export const { Reads, Store, Insights } = desktopServices;

export const inProcessWorkspace: Atom.Atom<Option.Option<WorkspaceState>> = Atom.make(
  Option.some(RUNNING),
);

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
  const commitTick = Atom.make(0).pipe(Atom.keepAlive);
  const lastStamp = Atom.make(Option.none<Stamp>()).pipe(Atom.keepAlive);

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
    .pipe(Atom.keepAlive);

  const syncHealth = StoreService.runtime
    .atom(Stream.unwrap(StoreService.use((store) => Effect.succeed(store("Health", undefined)))))
    .pipe(Atom.keepAlive);

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
    .pipe(Atom.keepAlive);

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

  return {
    wake,
    commits,
    insightChanges,
    commitTick,
    sync,
    healthTag,
    unavailable,
    health,
    command,
  };
};
