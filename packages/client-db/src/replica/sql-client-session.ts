import type { DeviceLabel } from "@store/contracts";
import { replicaState } from "@store/db/replica.schema";
import {
  layerOwnedHttpSync,
  mapReplicaStoreFailure,
  SyncScheduler,
  type ReplicaStore,
  type SyncState,
  type SyncTransport,
  type OwnedLiveHost,
} from "@store/sync";
import {
  layerSqliteReplicaStore,
  SqliteReplica,
  type SqliteReplicaHandle,
} from "@store/sync/sql-client";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { CommandAdmission } from "../store/admission";

export type SqliteReplicaIdentity = {
  readonly organizationId: string;
  readonly userId: string;
  readonly replicaId: string;
};

const seedReplicaIdentity = Effect.fn("ReplicaNodeSqlite.seedIdentity")(function* (
  handle: SqliteReplicaHandle,
  identity: SqliteReplicaIdentity,
) {
  const existing = yield* handle.db
    .select({ id: replicaState.id })
    .from(replicaState)
    .where(eq(replicaState.id, "singleton"))
    .all();
  if (existing.length > 0) return;
  yield* handle.db.insert(replicaState).values({
    id: "singleton",
    organizationId: identity.organizationId,
    userId: identity.userId,
    replicaId: identity.replicaId,
    epoch: "1",
    incarnation: "local",
    appliedCommitSequence: "0",
    nextClientSequence: "1",
    localCommitVersion: 0,
    activeGeneration: 1,
  });
});

export const layerSeededReplica = <E, R>(
  replica: Layer.Layer<SqliteReplica, E, R>,
  identity: SqliteReplicaIdentity,
) =>
  Layer.effectDiscard(
    SqliteReplica.use((handle) =>
      seedReplicaIdentity(handle, identity).pipe(Effect.mapError(mapReplicaStoreFailure)),
    ),
  ).pipe(Layer.provideMerge(replica));

export type SqliteReplicaServices = CommandAdmission | ReplicaStore | SyncScheduler | SqliteReplica;

type SqliteReplicaSessionInput<ReplicaError> = {
  readonly replica: Layer.Layer<SqliteReplica, ReplicaError>;
  readonly identity: SqliteReplicaIdentity;
  readonly databaseIdentity: string;
};

type SqliteReplicaSyncInput<ReplicaError, TransportError> =
  SqliteReplicaSessionInput<ReplicaError> & {
    readonly transport: Layer.Layer<SyncTransport, TransportError>;
    readonly live: OwnedLiveHost;
    readonly deviceLabel?: DeviceLabel | undefined;
  };

const ON_DEVICE: SyncState = { phase: "idle", cursor: undefined, live: false, owner: true };

const onDeviceScheduler = Layer.succeed(
  SyncScheduler,
  SyncScheduler.of({
    state: Stream.concat(Stream.make(ON_DEVICE), Stream.never),
    wake: () => Effect.void,
    setVisible: () => Effect.void,
    setNetworkOwner: () => Effect.void,
    setLiveConnected: () => Effect.void,
    shutdown: Effect.void,
  }),
);

export const layerSqliteReplicaSync = <ReplicaError, TransportError>(
  input: SqliteReplicaSyncInput<ReplicaError, TransportError>,
) =>
  Layer.mergeAll(
    layerOwnedHttpSync({ live: input.live, deviceLabel: input.deviceLabel }).pipe(
      Layer.provide(input.transport),
    ),
    Layer.fresh(CommandAdmission.layer),
  ).pipe(
    Layer.provideMerge(layerSqliteReplicaStore(input.databaseIdentity)),
    Layer.provideMerge(layerSeededReplica(input.replica, input.identity)),
  );

export const layerSqliteReplicaLocal = <ReplicaError>(
  input: SqliteReplicaSessionInput<ReplicaError>,
) =>
  Layer.mergeAll(onDeviceScheduler, Layer.fresh(CommandAdmission.layer)).pipe(
    Layer.provideMerge(layerSqliteReplicaStore(input.databaseIdentity, { decidesLocally: true })),
    Layer.provideMerge(layerSeededReplica(input.replica, input.identity)),
  );
