import { inventoryReplicaScope, sqliteReplicaFileName } from "@store/client-db";
import { inProcessLinks, type InProcessReplica } from "@store/client-db/in-process";
import { layerSqlClientReplicaSync } from "@store/client-db/sql-client";
import {
  catalogOpenFailure,
  inProcessWorkspace,
  makeInventoryServices,
  type InventoryHost,
  type ReplicaOpenIdentity,
} from "@store/inventory-react";
import {
  ReplicaStore,
  SyncEngine,
  SyncScheduler,
  type LiveNetworkSignal,
  type SyncWakeReason,
} from "@store/sync";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import { randomUUID } from "expo-crypto";

import type { LiveAccessToken } from "@/auth/session";

import { replicaSqlClient } from "./sqlite";

const replicaDatabaseName = (apiBaseUrl: string, organizationId: string, userId: string): string =>
  sqliteReplicaFileName(
    encodeURIComponent(`${inventoryReplicaScope(apiBaseUrl, organizationId)}:${userId}`),
  );

export type MobileReplicaControl = {
  readonly setVisible: (visible: boolean) => Promise<void>;
  readonly wakeSync: (reason: SyncWakeReason) => Promise<void>;
  readonly setPullMaxBytes: (maxBytes: number | undefined) => Promise<void>;
};

type MobileReplicaListener = {
  readonly opened: (control: MobileReplicaControl) => void;
  readonly closed: (control: MobileReplicaControl) => void;
};

type MobileHostInput = {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof globalThis.fetch;
  readonly liveAccessToken: LiveAccessToken;
  readonly network: LiveNetworkSignal;
  readonly listener: MobileReplicaListener;
};

class ReplicaDatabases extends Context.Service<
  ReplicaDatabases,
  {
    readonly hold: (databaseName: string) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@store/mobile/ReplicaDatabases") {
  static readonly layer = Layer.sync(ReplicaDatabases, () => {
    const locks = new Map<string, Semaphore.Semaphore>();
    const lockOf = (databaseName: string) => {
      const lock = locks.get(databaseName) ?? Semaphore.makeUnsafe(1);
      locks.set(databaseName, lock);
      return lock;
    };
    return ReplicaDatabases.of({
      hold: (databaseName) => {
        const lock = lockOf(databaseName);
        return Effect.asVoid(
          Effect.acquireRelease(lock.take(1), () => lock.release(1), { interruptible: true }),
        );
      },
    });
  });
}

const Session = Atom.make(Option.none<InProcessReplica>()).pipe(Atom.keepAlive);

const services = makeInventoryServices({
  ...inProcessLinks(Session),
  generation: Atom.map(Session, (session) => Option.map(session, () => 0)),
  workspace: inProcessWorkspace,
});

const openReplica = Effect.fn("MobileInventoryHost.open")(function* (
  input: MobileHostInput,
  identity: ReplicaOpenIdentity,
  registry: AtomRegistry.AtomRegistry,
) {
  const databaseName = replicaDatabaseName(
    input.apiBaseUrl,
    identity.organizationId,
    identity.userId,
  );
  yield* (yield* ReplicaDatabases).hold(databaseName);
  const session = yield* Layer.build(
    Layer.fresh(
      layerSqlClientReplicaSync({
        sqlClient: replicaSqlClient(databaseName),
        databaseName,
        identity: { ...identity, replicaId: randomUUID() },
        sync: {
          apiBaseUrl: input.apiBaseUrl,
          authenticatedFetch: input.authenticatedFetch,
          accessToken: input.liveAccessToken,
          network: input.network,
        },
      }),
    ),
  ).pipe(Effect.mapError(catalogOpenFailure));
  const cursor = yield* Context.get(session, ReplicaStore)
    .readSyncCursor()
    .pipe(Effect.mapError(catalogOpenFailure));
  const run = yield* FiberSet.makeRuntimePromise();
  const scheduler = Context.get(session, SyncScheduler);
  const engine = Context.get(session, SyncEngine);
  const control: MobileReplicaControl = {
    setVisible: (visible) => run(scheduler.setVisible(visible)),
    wakeSync: (reason) => run(scheduler.wake(reason)),
    setPullMaxBytes: (maxBytes) => run(engine.setPullMaxBytes(maxBytes)),
  };
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      input.listener.opened(control);
      registry.set(Session, Option.some(session));
    }),
    () => Effect.sync(() => input.listener.closed(control)),
  );
  return { replicaId: cursor.replicaId, retryRecovery: Effect.void };
});

export const createMobileInventoryHost = (input: MobileHostInput): InventoryHost => {
  const runtime = ManagedRuntime.make(ReplicaDatabases.layer);
  return {
    apiBaseUrl: input.apiBaseUrl,
    deviceId: randomUUID(),
    services,
    open: (identity, registry) =>
      runtime.contextEffect.pipe(
        Effect.flatMap((host) => Effect.provide(openReplica(input, identity, registry), host)),
      ),
  };
};
