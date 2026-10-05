import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  NOTICE_BUFFER_CAPACITY,
  offerCoalescing,
  sameSyncHealth,
  syncHealthOf,
  toClientNotice,
  type ReplicaCommitNotice,
  type ReplicaSyncHealth,
} from "@store/client-db";
import {
  backUpReplicaFile,
  discardReplicaFile,
  readReplicaFileSummary,
  sealReplicaFile,
  settleReplicaFile,
  stageReplicaBackup,
} from "@store/client-db/node-backup";
import { layerNodeLicenceGate, ShopLicence } from "@store/client-db/node-licence";
import { layerNodeLocalReplica, type SqliteReplicaServices } from "@store/client-db/node-sqlite";
import { layerNodeStaffGate } from "@store/client-db/node-staff";
import {
  CommandAdmission,
  layerInventoryStore,
  type LicenceGate,
  StaffGate,
} from "@store/client-db/store";
import { LOCAL_ORGANIZATION_ID, LOCAL_USER_ID } from "@store/contracts";
import { InventoryStore } from "@store/contracts/replica";
import { ReplicaStore, SyncScheduler } from "@store/sync";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as RpcServer from "effect/rpc/RpcServer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { makeRendererServers, noRendererServers } from "./renderer-servers";
import {
  catalogCountsOf,
  commitStampOf,
  ReplicaWorkerFailure,
  ReplicaWorkerRpcs,
  type ReplicaWorkerBoot,
} from "./replica-rpc";

const workerFailure = (cause: unknown) =>
  new ReplicaWorkerFailure({
    message: cause instanceof Error ? cause.message : "Replica worker failed.",
  });

type WorkerBoot = typeof ReplicaWorkerBoot.Type;

const ORGANIZATION_BACKUP_MESSAGE =
  "This backup is a copy of an organization's data. Only a backup of this device's own workspace can be restored here.";

const UNOPENABLE_BACKUP_MESSAGE = "This backup could not be opened by this version of Tabaaq.";

const fileFailure = (failure: { readonly message: string }) =>
  new ReplicaWorkerFailure({ message: failure.message });

const OWNER_ONLY_MESSAGE = "Only the owner can do this. Unlock as the owner and try again.";

const StaffGateLive = layerNodeStaffGate().pipe(Layer.provide(NodeCrypto.layer));

type Session = Context.Context<SqliteReplicaServices | StaffGate | LicenceGate | ShopLicence>;

const sessionInput = (config: WorkerBoot) => ({
  path: config.databasePath,
  identity: {
    organizationId: LOCAL_ORGANIZATION_ID,
    userId: LOCAL_USER_ID,
    replicaId: config.replicaId,
  },
  databaseIdentity: config.databasePath,
});

const onDeviceHealth = (health: ReplicaSyncHealth): ReplicaSyncHealth => {
  switch (health._tag) {
    case "running":
      return { _tag: "running" };
    case "storageError":
    case "updateRequired":
    case "recoveryRequired":
      return health;
  }
};

const openSession = (
  session: Layer.Layer<SqliteReplicaServices, unknown>,
  scope: Scope.Scope,
): Effect.Effect<Session, unknown> =>
  Layer.buildWithScope(
    Layer.fresh(Layer.provideMerge(Layer.merge(StaffGateLive, layerNodeLicenceGate), session)),
    scope,
  ).pipe(Effect.tap((built) => Context.get(built, ReplicaStore).readSyncCursor()));

export const makeReplicaWorkerHandlers = <R>(boot: Effect.Effect<WorkerBoot, unknown, R>) =>
  ReplicaWorkerRpcs.toLayer(
    Effect.gen(function* () {
      const config = yield* boot;
      const sessionScope = yield* Scope.fork(yield* Effect.scope);
      const opened = yield* openSession(
        layerNodeLocalReplica(sessionInput(config)),
        sessionScope,
      ).pipe(
        Effect.map(Option.some),
        Effect.catchCause((cause) =>
          Cause.hasInterrupts(cause)
            ? Effect.interrupt
            : Effect.logError("ReplicaWorker.open_failed", cause).pipe(
                Effect.andThen(Scope.close(sessionScope, Exit.void)),
                Effect.as(Option.none<Session>()),
              ),
        ),
      );
      const live = yield* Ref.make(opened);

      const health = Option.match(opened, {
        onNone: () =>
          Stream.concat(Stream.succeed<ReplicaSyncHealth>({ _tag: "running" }), Stream.never),
        onSome: (session) =>
          SubscriptionRef.changes(Context.get(session, SyncScheduler).state).pipe(
            Stream.map(syncHealthOf),
          ),
      }).pipe(Stream.map(onDeviceHealth), Stream.changesWith(sameSyncHealth));

      const renderers = yield* Option.match(opened, {
        onNone: () => Effect.succeed(noRendererServers),
        onSome: (session) =>
          makeRendererServers((protocol) =>
            RpcServer.layer(InventoryStore).pipe(
              Layer.provide(
                Layer.merge(
                  layerInventoryStore,
                  InventoryStore.toLayerHandler("Health", () => health),
                ),
              ),
              Layer.provide(Layer.succeedContext(session)),
              Layer.provide(protocol),
            ),
          ),
      });

      const withSession = <A, E>(use: (session: Session) => Effect.Effect<A, E>) =>
        Ref.get(live).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(new ReplicaWorkerFailure({ message: "Replica worker is not booted." })),
              onSome: (session) => Effect.mapError(use(session), workerFailure),
            }),
          ),
        );

      const ownerOnly = Ref.get(live).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.void,
            onSome: (session) =>
              Context.get(session, StaffGate)
                .authorize("manageShop")
                .pipe(
                  Effect.mapError(() => new ReplicaWorkerFailure({ message: OWNER_ONLY_MESSAGE })),
                  Effect.asVoid,
                ),
          }),
        ),
      );

      const stamp = withSession((session) => Context.get(session, ReplicaStore).readStamp());

      const stageRestore = (sourcePath: string, stagedPath: string) =>
        Effect.gen(function* () {
          const backup = yield* stageReplicaBackup({ sourcePath, stagedPath });
          if (backup.organizationId !== LOCAL_ORGANIZATION_ID || backup.userId !== LOCAL_USER_ID) {
            return yield* new ReplicaWorkerFailure({ message: ORGANIZATION_BACKUP_MESSAGE });
          }
          yield* Effect.scopedWith((trial) =>
            openSession(
              layerNodeLocalReplica({
                ...sessionInput(config),
                path: stagedPath,
                databaseIdentity: stagedPath,
              }),
              trial,
            ),
          ).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterrupts(cause)
                ? Effect.interrupt
                : Effect.fail(new ReplicaWorkerFailure({ message: UNOPENABLE_BACKUP_MESSAGE })),
            ),
          );
          const current = yield* readReplicaFileSummary(config.databasePath);
          return { current: catalogCountsOf(current), backup: catalogCountsOf(backup) };
        }).pipe(
          Effect.onError(() => discardReplicaFile(stagedPath)),
          Effect.mapError(fileFailure),
        );

      const releaseForRestore = (stagedPath: string) =>
        Effect.gen(function* () {
          const sealed = yield* withSession((session) =>
            Context.get(session, CommandAdmission).exclusive(
              Effect.gen(function* () {
                yield* renderers.shutdown;
                yield* Context.get(session, SyncScheduler).shutdown;
                const final = yield* Context.get(session, ReplicaStore).readStamp();
                yield* Ref.set(live, Option.none());
                yield* Scope.close(sessionScope, Exit.void);
                return final;
              }),
            ),
          );
          yield* settleReplicaFile(config.databasePath);
          yield* sealReplicaFile(stagedPath, sealed.localCommitVersion);
        }).pipe(Effect.mapError(fileFailure));

      return ReplicaWorkerRpcs.of({
        Engine: () => Effect.succeed(Option.isNone(opened) ? "unavailable" : "sqlite"),
        AttachRenderer: ({ port }) => renderers.attach(port),
        Stamp: () => stamp,
        BackUp: ({ destinationPath }) =>
          Effect.andThen(
            ownerOnly,
            backUpReplicaFile({ databasePath: config.databasePath, destinationPath }).pipe(
              Effect.mapError(
                (failure) =>
                  new ReplicaWorkerFailure({
                    message: `The backup could not be written. ${failure.message}`,
                  }),
              ),
            ),
          ),
        StageRestore: ({ sourcePath, stagedPath }) =>
          Effect.andThen(ownerOnly, stageRestore(sourcePath, stagedPath)),
        ReleaseForRestore: ({ stagedPath }) =>
          Effect.andThen(ownerOnly, releaseForRestore(stagedPath)),
        Commits: () =>
          Option.match(opened, {
            onNone: () => Stream.empty,
            onSome: (session) =>
              Stream.callback<ReplicaCommitNotice>(
                (queue) =>
                  Context.get(session, ReplicaStore).commits.pipe(
                    Stream.runForEach((notice) =>
                      offerCoalescing(queue, toClientNotice(config.databasePath, notice)),
                    ),
                    Effect.forkScoped({ startImmediately: true }),
                  ),
                { bufferSize: NOTICE_BUFFER_CAPACITY, strategy: "suspend" },
              ).pipe(
                Stream.map((notice) =>
                  Object.assign(
                    {
                      ...commitStampOf(notice),
                      touchedEntities: notice.touchedEntities,
                      touchedKeys: notice.touchedKeys,
                    },
                    notice.fullInvalidation === undefined
                      ? undefined
                      : { fullInvalidation: notice.fullInvalidation },
                    notice.overflowedEntities === undefined
                      ? undefined
                      : { overflowedEntities: notice.overflowedEntities },
                  ),
                ),
              ),
          }),
        SetLicence: ({ state }) =>
          withSession((session) => Context.get(session, ShopLicence).accept(state)),
        DatabaseShop: () =>
          withSession((session) => Context.get(session, ShopLicence).shop).pipe(
            Effect.map((shop) => ({ shopId: Option.getOrNull(shop) })),
          ),
      });
    }),
  );
