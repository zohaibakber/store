import { inventoryReplicaScope, sqliteReplicaFileName } from "@store/client-db";
import { inProcessLinks, type InProcessReplica } from "@store/client-db/in-process";
import {
  openSqlClientReplicaHandle,
  type SqlClientReplicaHandle,
} from "@store/client-db/sql-client";
import {
  catalogOpenFailure,
  inProcessWorkspace,
  makeInventoryServices,
  type InventoryHost,
} from "@store/inventory-react";
import type { LiveNetworkSignal } from "@store/sync";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Atom from "effect/reactivity/Atom";
import * as Semaphore from "effect/Semaphore";
import { randomUUID } from "expo-crypto";

import type { LiveAccessToken } from "@/auth/session";

import { replicaSqlClient } from "./sqlite";

const replicaDatabaseName = (apiBaseUrl: string, organizationId: string, userId: string): string =>
  sqliteReplicaFileName(
    encodeURIComponent(`${inventoryReplicaScope(apiBaseUrl, organizationId)}:${userId}`),
  );

const databaseLocks = new Map<string, Semaphore.Semaphore>();

const exclusive = <A, E>(databaseName: string, work: Effect.Effect<A, E>): Effect.Effect<A, E> => {
  const lock = databaseLocks.get(databaseName) ?? Semaphore.makeUnsafe(1);
  databaseLocks.set(databaseName, lock);
  return lock.withPermit(work);
};

type MobileReplicaListener = {
  readonly opened: (handle: SqlClientReplicaHandle) => void;
  readonly closed: (handle: SqlClientReplicaHandle) => void;
};

const Session = Atom.make(Option.none<InProcessReplica>()).pipe(Atom.keepAlive);

const services = makeInventoryServices({
  ...inProcessLinks(Session),
  generation: Atom.map(Session, (session) => Option.map(session, () => 0)),
  workspace: inProcessWorkspace,
});

export const createMobileInventoryHost = (input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof globalThis.fetch;
  readonly liveAccessToken: LiveAccessToken;
  readonly network: LiveNetworkSignal;
  readonly listener: MobileReplicaListener;
}): InventoryHost => ({
  apiBaseUrl: input.apiBaseUrl,
  deviceId: randomUUID(),
  services,
  open: (identity, registry) => {
    const databaseName = replicaDatabaseName(
      input.apiBaseUrl,
      identity.organizationId,
      identity.userId,
    );
    const opening = exclusive(
      databaseName,
      Effect.tryPromise({
        try: () =>
          openSqlClientReplicaHandle({
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
        catch: catalogOpenFailure,
      }),
    );
    return Effect.acquireRelease(
      Effect.tap(opening, (handle) =>
        Effect.sync(() => {
          input.listener.opened(handle);
          registry.set(Session, Option.some(handle.services));
        }),
      ),
      (handle) =>
        Effect.sync(() => input.listener.closed(handle)).pipe(
          Effect.andThen(
            exclusive(
              databaseName,
              Effect.tryPromise(() => handle.close()),
            ),
          ),
          Effect.ignore,
        ),
    ).pipe(
      Effect.map((handle) => ({
        replicaId: handle.replicaId,
        retryRecovery: Effect.ignore(
          Effect.tryPromise(() => handle.retryRecovery?.() ?? Promise.resolve()),
        ),
      })),
    );
  },
});
