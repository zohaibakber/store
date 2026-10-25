import {
  NOTICE_BUFFER_CAPACITY,
  offerCoalescing,
  sameSyncHealth,
  syncHealthOf,
  toClientNotice,
  withAuthRefreshing,
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
import { layerShopLicence, ShopLicence } from "@store/client-db/node-licence";
import {
  commitPublish,
  ImportRefused,
  makeImportClient,
  readPublishStatus,
  readPublishSummary,
  stagePublish,
  type ImportClient,
  type ReplicaPublishCommit,
} from "@store/client-db/node-publish";
import {
  layerNodeLocalReplica,
  layerNodeReplicaSync,
  makePinnedHttp,
  type SqliteReplicaServices,
} from "@store/client-db/node-sqlite";
import { layerNodeStaffGate } from "@store/client-db/node-staff";
import { CommandAdmission, layerInventoryStore, StaffGate } from "@store/client-db/store";
import { InventoryStore } from "@store/contracts/replica";
import { ReplicaStore, SyncScheduler } from "@store/sync";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as RpcServer from "effect/rpc/RpcServer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { ReplicaFileRefused } from "../src/host/file-refusal";
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

const PUBLISH_NEEDS_ORGANIZATION = "Sign in to an organization to move this device's data.";

const ORGANIZATION_REQUIRED = "ORGANIZATION_REQUIRED";

const fileFailure = (
  failure: ReplicaFileRefused | { readonly message: string; readonly code?: string },
) => {
  if (failure instanceof ReplicaFileRefused) return failure;
  if (failure.code === ORGANIZATION_REQUIRED) {
    return new ReplicaFileRefused({ reason: "publish-needs-sign-in" });
  }
  return new ReplicaWorkerFailure({ message: failure.message });
};

const StaffGateLive = layerNodeStaffGate();

type Session = Context.Context<SqliteReplicaServices | StaffGate | ShopLicence>;

type AuthorityLink = {
  readonly session: Layer.Layer<SqliteReplicaServices, unknown, Crypto.Crypto>;
  readonly setToken: (token: Redacted.Redacted<string> | null) => Effect.Effect<void>;
  readonly setForeground: (
    scheduler: SyncScheduler["Service"],
    visible: boolean,
  ) => Effect.Effect<void>;
  readonly healthOf: (health: Stream.Stream<ReplicaSyncHealth>) => Stream.Stream<ReplicaSyncHealth>;
  readonly imports: ImportClient;
};

const sessionInput = (config: WorkerBoot) => ({
  path: config.databasePath,
  identity: {
    organizationId: config.organizationId,
    userId: config.userId,
    replicaId: config.replicaId,
  },
  databaseIdentity: config.databasePath,
});

const linkRemoteAuthority = Effect.fnUntraced(function* (
  config: Extract<WorkerBoot, { readonly authority: "remote" }>,
) {
  const http = yield* makePinnedHttp(config.apiBaseUrl);
  const runPromise = yield* FiberSet.makeRuntimePromise<never>();
  return {
    session: layerNodeReplicaSync({
      ...sessionInput(config),
      transport: http.syncTransport,
      live: {
        apiBaseUrl: config.apiBaseUrl,
        accessToken: (options) => runPromise(http.liveAccessToken(options)),
      },
      deviceLabel: config.deviceLabel,
    }),
    setToken: http.setToken,
    setForeground: (scheduler, visible) =>
      scheduler
        .setVisible(visible)
        .pipe(Effect.andThen(visible ? scheduler.wake("focus") : Effect.void)),
    healthOf: (health) =>
      Stream.zipLatest(health, http.refreshing).pipe(
        Stream.map(([current, refreshing]) => withAuthRefreshing(current, refreshing)),
      ),
    imports: makeImportClient(http.client, config.apiBaseUrl),
  } satisfies AuthorityLink;
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

const needsOrganization = Effect.fail(
  new ImportRefused({ code: ORGANIZATION_REQUIRED, message: PUBLISH_NEEDS_ORGANIZATION }),
);

const localImports: ImportClient = {
  stagePart: () => needsOrganization,
  commit: () => needsOrganization,
  status: () => needsOrganization,
};

const linkLocalAuthority = (
  config: Extract<WorkerBoot, { readonly authority: "local" }>,
): AuthorityLink => ({
  session: layerNodeLocalReplica(sessionInput(config)),
  setToken: () => Effect.void,
  setForeground: () => Effect.void,
  healthOf: Stream.map(onDeviceHealth),
  imports: localImports,
});

const linkAuthority = (config: WorkerBoot): Effect.Effect<AuthorityLink, never, Scope.Scope> => {
  switch (config.authority) {
    case "local":
      return Effect.succeed(linkLocalAuthority(config));
    case "remote":
      return linkRemoteAuthority(config);
  }
};

const openSession = (
  session: Layer.Layer<SqliteReplicaServices, unknown, Crypto.Crypto>,
  crypto: Crypto.Crypto,
  scope: Scope.Scope,
): Effect.Effect<Session, unknown> =>
  Layer.buildWithScope(
    Layer.fresh(Layer.provideMerge(Layer.mergeAll(StaffGateLive, layerShopLicence), session)).pipe(
      Layer.provide(Layer.succeed(Crypto.Crypto, crypto)),
    ),
    scope,
  ).pipe(Effect.tap((built) => Context.get(built, ReplicaStore).readSyncCursor()));

export const makeReplicaWorkerHandlers = <R>(boot: Effect.Effect<WorkerBoot, unknown, R>) =>
  ReplicaWorkerRpcs.toLayer(
    Effect.gen(function* () {
      const config = yield* boot;
      const crypto = yield* Crypto.Crypto;
      const link = yield* linkAuthority(config);

      const sessionScope = yield* Scope.fork(yield* Effect.scope);
      const opened = yield* openSession(link.session, crypto, sessionScope).pipe(
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

      const health = link
        .healthOf(
          Option.match(opened, {
            onNone: () =>
              Stream.concat(Stream.succeed<ReplicaSyncHealth>({ _tag: "running" }), Stream.never),
            onSome: (session) =>
              SubscriptionRef.changes(Context.get(session, SyncScheduler).state).pipe(
                Stream.map(syncHealthOf),
              ),
          }),
        )
        .pipe(Stream.changesWith(sameSyncHealth));

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
              Layer.provide(Layer.succeed(Crypto.Crypto, crypto)),
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
                  Effect.mapError(() => new ReplicaFileRefused({ reason: "owner-only" })),
                  Effect.asVoid,
                ),
          }),
        ),
      );

      const stamp = withSession((session) => Context.get(session, ReplicaStore).readStamp());

      const wake = (reason: "focus" | "reconnect") =>
        withSession((session) => Context.get(session, SyncScheduler).wake(reason)).pipe(
          Effect.ignore,
        );

      const stageRestore = (
        local: Extract<WorkerBoot, { readonly authority: "local" }>,
        sourcePath: string,
        stagedPath: string,
      ) =>
        Effect.gen(function* () {
          const backup = yield* stageReplicaBackup({ sourcePath, stagedPath });
          if (backup.organizationId !== local.organizationId || backup.userId !== local.userId) {
            return yield* new ReplicaFileRefused({ reason: "organization-backup" });
          }
          yield* Effect.scopedWith((trial) =>
            openSession(
              layerNodeLocalReplica({
                ...sessionInput(local),
                path: stagedPath,
                databaseIdentity: stagedPath,
              }),
              crypto,
              trial,
            ),
          ).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterrupts(cause)
                ? Effect.interrupt
                : Effect.fail(new ReplicaFileRefused({ reason: "unopenable-backup" })),
            ),
          );
          const current = yield* readReplicaFileSummary(local.databasePath);
          return { current: catalogCountsOf(current), backup: catalogCountsOf(backup) };
        }).pipe(
          Effect.onError(() => discardReplicaFile(stagedPath)),
          Effect.mapError(fileFailure),
        );

      const releaseForRestore = (
        local: Extract<WorkerBoot, { readonly authority: "local" }>,
        stagedPath: string,
      ) =>
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
          yield* settleReplicaFile(local.databasePath);
          yield* sealReplicaFile(stagedPath, sealed.localCommitVersion);
        }).pipe(Effect.mapError(fileFailure));

      const afterPublish = (sourcePath: string, outcome: ReplicaPublishCommit) => {
        switch (outcome._tag) {
          case "committed":
            return settleReplicaFile(sourcePath).pipe(Effect.ignore, Effect.andThen(wake("focus")));
          case "refused":
          case "unconfirmed":
            return Effect.void;
        }
      };

      return ReplicaWorkerRpcs.of({
        Engine: () => Effect.succeed(Option.isNone(opened) ? "unavailable" : "sqlite"),
        AttachRenderer: ({ port }) => renderers.attach(port),
        Stamp: () => stamp,
        SetForeground: ({ visible }) =>
          Option.isNone(opened)
            ? Effect.void
            : withSession((session) =>
                link.setForeground(Context.get(session, SyncScheduler), visible),
              ),
        BackUp: ({ destinationPath }) =>
          Effect.andThen(
            ownerOnly,
            backUpReplicaFile({ databasePath: config.databasePath, destinationPath }).pipe(
              Effect.mapError(
                (failure) =>
                  new ReplicaFileRefused({
                    reason: "backup-write-failed",
                    detail: failure.message,
                  }),
              ),
            ),
          ),
        StageRestore: ({ sourcePath, stagedPath }) => {
          switch (config.authority) {
            case "local":
              return Effect.andThen(ownerOnly, stageRestore(config, sourcePath, stagedPath));
            case "remote":
              return Effect.fail(new ReplicaFileRefused({ reason: "restore-local-only" }));
          }
        },
        ReleaseForRestore: ({ stagedPath }) => {
          switch (config.authority) {
            case "local":
              return Effect.andThen(ownerOnly, releaseForRestore(config, stagedPath));
            case "remote":
              return Effect.fail(new ReplicaFileRefused({ reason: "restore-local-only" }));
          }
        },
        PublishSummary: ({ sourcePath }) =>
          readPublishSummary(sourcePath).pipe(Effect.mapError(fileFailure)),
        PublishStage: ({ sourcePath, importId }) =>
          Stream.unwrap(
            Effect.as(
              ownerOnly,
              stagePublish({ path: sourcePath, importId, client: link.imports }).pipe(
                Stream.mapError(fileFailure),
              ),
            ),
          ),
        PublishCommit: ({ sourcePath, importId, seal }) =>
          Effect.andThen(
            ownerOnly,
            commitPublish({
              organizationId: config.organizationId,
              importId,
              seal,
              client: link.imports,
            }).pipe(Effect.tap((outcome) => afterPublish(sourcePath, outcome))),
          ),
        PublishStatus: ({ importId }) => readPublishStatus({ importId, client: link.imports }),
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
        SyncHealth: () => health,
        SetAccessToken: ({ token }) =>
          link
            .setToken(token)
            .pipe(Effect.andThen(token === null ? Effect.void : wake("reconnect"))),
        SetLicence: ({ state }) =>
          withSession((session) => Context.get(session, ShopLicence).accept(state)),
        DatabaseShop: () =>
          withSession((session) => Context.get(session, ShopLicence).shop).pipe(
            Effect.map((shop) => ({ shopId: Option.getOrNull(shop) })),
          ),
      });
    }),
  );
