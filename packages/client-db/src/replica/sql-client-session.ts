import type { DeviceLabel } from "@store/contracts";
import { replicaState } from "@store/db/replica.schema";
import {
  layerOwnedHttpSync,
  layerOwnedLocalSync,
  mapReplicaStoreFailure,
  type ReplicaStore,
  type SyncEngine,
  type SyncScheduler,
  type SyncTransportService,
  type OwnedLiveHost,
  type SyncSchedulerPolicy,
} from "@store/sync";
import {
  layerSqliteReplicaStore,
  LocalAuthority,
  SqliteReplica,
  type SqliteReplicaHandle,
  type SqliteReplicaStoreOptions,
} from "@store/sync/sql-client";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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

export type SqliteReplicaServices =
  | CommandAdmission
  | ReplicaStore
  | SyncEngine
  | SyncScheduler
  | SqliteReplica;

type SqliteReplicaSessionInput<ReplicaError> = {
  readonly replica: Layer.Layer<SqliteReplica, ReplicaError>;
  readonly identity: SqliteReplicaIdentity;
  readonly databaseIdentity: string;
};

type SqliteReplicaSyncInput<ReplicaError, TransportError> =
  SqliteReplicaSessionInput<ReplicaError> & {
    readonly transport: Layer.Layer<SyncTransportService, TransportError>;
    readonly live: OwnedLiveHost;
    readonly policy?: SyncSchedulerPolicy;
    readonly deviceLabel?: DeviceLabel | undefined;
  };

type SqliteReplicaAuthority<SyncError> = {
  readonly sync: Layer.Layer<SyncEngine | SyncScheduler, SyncError, ReplicaStore | SqliteReplica>;
  readonly store: SqliteReplicaStoreOptions;
};

const layerSqliteReplicaSession = <ReplicaError, SyncError>(
  input: SqliteReplicaSessionInput<ReplicaError>,
  authority: SqliteReplicaAuthority<SyncError>,
) =>
  Layer.mergeAll(authority.sync, Layer.fresh(CommandAdmission.layer)).pipe(
    Layer.provideMerge(layerSqliteReplicaStore(input.databaseIdentity, authority.store)),
    Layer.provideMerge(layerSeededReplica(input.replica, input.identity)),
  );

const httpAuthority = <ReplicaError, TransportError>(
  input: SqliteReplicaSyncInput<ReplicaError, TransportError>,
) => ({
  sync: layerOwnedHttpSync({
    databaseIdentity: input.databaseIdentity,
    live: input.live,
    policy: input.policy,
    deviceLabel: input.deviceLabel,
  }).pipe(Layer.provide(input.transport)),
  store: {},
});

const localAuthority = () => ({
  sync: layerOwnedLocalSync.pipe(Layer.provide(LocalAuthority.layer)),
  store: { authority: LocalAuthority.submitWithin },
});

export const layerSqliteReplicaSync = <ReplicaError, TransportError>(
  input: SqliteReplicaSyncInput<ReplicaError, TransportError>,
) => layerSqliteReplicaSession(input, httpAuthority(input));

export const layerSqliteReplicaLocal = <ReplicaError>(
  input: SqliteReplicaSessionInput<ReplicaError>,
) => layerSqliteReplicaSession(input, localAuthority());
