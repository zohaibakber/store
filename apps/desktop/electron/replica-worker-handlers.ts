import {
  NOTICE_BUFFER_CAPACITY,
  offerCoalescing,
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
  type ReplicaFileSummary,
} from "@store/client-db/node-backup";
import {
  makeProxySyncTransport,
  openNodeLocalReplicaSession,
  openNodeReplicaSyncSession,
  type NodeReplicaSyncSession,
  type SyncProxyRequest,
} from "@store/client-db/node-sqlite";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { identity } from "effect/Function";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { PROXY_CONCURRENCY, SNAPSHOT_DOWNLOAD_CONCURRENCY } from "./replica-admission";
import { makePendingReplies, makeSharedFlight } from "./replica-pending";
import {
  ReplicaWorkerFailure,
  ReplicaWorkerRpcs,
  type AccessTokenRequest,
  type AccessTokenResult,
  type ProxyFetchRequest,
  type ProxyFetchResult,
  type ReplicaWorkerBoot,
} from "./replica-rpc";

const PROXY_QUEUE_CAPACITY = 16;
const TOKEN_QUEUE_CAPACITY = 2;

const PROXY_REPLY_GRACE = Duration.seconds(5);
const TOKEN_REPLY_LIMIT = Duration.seconds(30);

const SNAPSHOT_PART = /^\/api\/sync\/snapshots\/[^/]+\/parts\/\d+$/u;

const isSnapshotDownload = (request: SyncProxyRequest) =>
  request.method === "GET" && SNAPSHOT_PART.test(request.pathname);

const workerFailure = (cause: unknown) =>
  new ReplicaWorkerFailure({
    message: cause instanceof Error ? cause.message : "Replica worker failed.",
  });

const stampOf = (stamp: {
  readonly generationId: string;
  readonly localCommitVersion: number;
}) => ({
  generationId: stamp.generationId,
  localCommitVersion: stamp.localCommitVersion,
});

const timedOutProxy = (): ProxyFetchResult => ({
  ok: false,
  status: 504,
  bodyText: "The sync proxy did not answer in time.",
});

type WorkerBoot = typeof ReplicaWorkerBoot.Type;

const LOCAL_ONLY_MESSAGE = "Only the workspace on this device can be restored from a file.";

const ORGANIZATION_BACKUP_MESSAGE =
  "This backup is a copy of an organization's data. Only a backup of this device's own workspace can be restored here.";

const UNOPENABLE_BACKUP_MESSAGE = "This backup could not be opened by this version of Tabaaq.";

const fileFailure = (failure: { readonly message: string }) =>
  new ReplicaWorkerFailure({ message: failure.message });

const countsOf = (summary: ReplicaFileSummary) => ({
  products: summary.products,
  sales: summary.sales,
});

type AuthorityLink = {
  readonly open: () => Promise<NodeReplicaSyncSession>;
  readonly proxyRequests: Stream.Stream<typeof ProxyFetchRequest.Type>;
  readonly respondProxy: (requestId: string, result: ProxyFetchResult) => Effect.Effect<void>;
  readonly tokenRequests: Stream.Stream<typeof AccessTokenRequest.Type>;
  readonly respondToken: (requestId: string, token: AccessTokenResult) => Effect.Effect<void>;
  readonly setForeground: (session: NodeReplicaSyncSession, visible: boolean) => Promise<void>;
  readonly healthOf: (health: ReplicaSyncHealth) => ReplicaSyncHealth;
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

const linkRemoteAuthority = (
  config: Extract<WorkerBoot, { readonly authority: "remote" }>,
  openSession: typeof openNodeReplicaSyncSession,
): Effect.Effect<AuthorityLink, never, Scope.Scope> =>
  Effect.gen(function* () {
    const proxyRequests = yield* Queue.bounded<typeof ProxyFetchRequest.Type>(PROXY_QUEUE_CAPACITY);
    const proxyReplies = makePendingReplies<ProxyFetchResult>();
    const tokenRequests =
      yield* Queue.bounded<typeof AccessTokenRequest.Type>(TOKEN_QUEUE_CAPACITY);
    const tokenReplies = makePendingReplies<AccessTokenResult>();
    const proxyTurns = yield* Semaphore.make(PROXY_CONCURRENCY);
    const snapshotTurns = yield* Semaphore.make(SNAPSHOT_DOWNLOAD_CONCURRENCY);

    const proxyFetch = (request: SyncProxyRequest): Effect.Effect<ProxyFetchResult> => {
      const requestId = crypto.randomUUID();
      const exchange = proxyTurns.withPermits(1)(
        proxyReplies.ask(requestId, Queue.offer(proxyRequests, { requestId, ...request })),
      );
      const admitted = isSnapshotDownload(request)
        ? snapshotTurns.withPermits(1)(exchange)
        : exchange;
      return admitted.pipe(
        Effect.timeoutOption(
          Duration.sum(Duration.millis(request.timeoutMillis), PROXY_REPLY_GRACE),
        ),
        Effect.map((reply) => (reply._tag === "Some" ? reply.value : timedOutProxy())),
      );
    };

    const sharedToken = yield* makeSharedFlight(tokenReplies, (force: boolean, requestId) =>
      Queue.offer(tokenRequests, { requestId, force }),
    );

    return {
      open: () =>
        openSession({
          ...sessionInput(config),
          transport: makeProxySyncTransport((request) => Effect.runPromise(proxyFetch(request))),
          live: {
            apiBaseUrl: config.apiBaseUrl,
            accessToken: ({ force }) =>
              Effect.runPromise(sharedToken(force, null, TOKEN_REPLY_LIMIT)),
          },
        }),
      proxyRequests: Stream.fromQueue(proxyRequests),
      respondProxy: proxyReplies.respond,
      tokenRequests: Stream.fromQueue(tokenRequests),
      respondToken: tokenReplies.respond,
      setForeground: async (session, visible) => {
        await session.setVisible(visible);
        if (visible) await session.wake("focus");
      },
      healthOf: identity,
    };
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

const linkLocalAuthority = (
  config: Extract<WorkerBoot, { readonly authority: "local" }>,
  openSession: typeof openNodeLocalReplicaSession,
): AuthorityLink => ({
  open: () => openSession(sessionInput(config)),
  proxyRequests: Stream.never,
  respondProxy: () => Effect.void,
  tokenRequests: Stream.never,
  respondToken: () => Effect.void,
  setForeground: () => Promise.resolve(),
  healthOf: onDeviceHealth,
});

const linkAuthority = (
  config: WorkerBoot,
  openSession: typeof openNodeReplicaSyncSession,
  openLocalSession: typeof openNodeLocalReplicaSession,
): Effect.Effect<AuthorityLink, never, Scope.Scope> => {
  switch (config.authority) {
    case "local":
      return Effect.succeed(linkLocalAuthority(config, openLocalSession));
    case "remote":
      return linkRemoteAuthority(config, openSession);
  }
};

export const makeReplicaWorkerHandlers = <R>(
  boot: Effect.Effect<WorkerBoot, unknown, R>,
  openSession = openNodeReplicaSyncSession,
  openLocalSession = openNodeLocalReplicaSession,
) =>
  ReplicaWorkerRpcs.toLayer(
    Effect.gen(function* () {
      const config = yield* boot;
      const syncHealth = yield* SubscriptionRef.make<ReplicaSyncHealth>({ _tag: "running" });
      const link = yield* linkAuthority(config, openSession, openLocalSession);

      const live = yield* Ref.make<NodeReplicaSyncSession | undefined>(undefined);

      const opened = yield* Effect.acquireRelease(
        Effect.tryPromise(link.open).pipe(
          Effect.map((session): NodeReplicaSyncSession | undefined => session),
          Effect.orElseSucceed((): NodeReplicaSyncSession | undefined => undefined),
          Effect.tap((session) => Ref.set(live, session)),
        ),
        () =>
          Ref.getAndSet(live, undefined).pipe(
            Effect.flatMap((session) =>
              session === undefined
                ? Effect.void
                : Effect.promise(() => session.close()).pipe(Effect.ignore),
            ),
          ),
      );

      if (opened !== undefined) {
        const unsubscribe = opened.subscribeSyncHealth((health) => {
          Effect.runSync(SubscriptionRef.set(syncHealth, link.healthOf(health)));
        });
        yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
      }

      const withSession = <A>(use: (current: NodeReplicaSyncSession) => Promise<A>) =>
        Ref.get(live).pipe(
          Effect.flatMap((current) =>
            current === undefined
              ? Effect.fail(new ReplicaWorkerFailure({ message: "Replica worker is not booted." }))
              : Effect.tryPromise({ try: () => use(current), catch: workerFailure }),
          ),
        );

      const stageRestore = (
        local: Extract<WorkerBoot, { readonly authority: "local" }>,
        sourcePath: string,
        stagedPath: string,
      ) =>
        Effect.gen(function* () {
          const backup = yield* stageReplicaBackup({ sourcePath, stagedPath });
          if (backup.organizationId !== local.organizationId || backup.userId !== local.userId) {
            return yield* new ReplicaWorkerFailure({ message: ORGANIZATION_BACKUP_MESSAGE });
          }
          yield* Effect.acquireUseRelease(
            Effect.tryPromise({
              try: () =>
                openLocalSession({
                  ...sessionInput(local),
                  path: stagedPath,
                  databaseIdentity: stagedPath,
                }),
              catch: () => new ReplicaWorkerFailure({ message: UNOPENABLE_BACKUP_MESSAGE }),
            }),
            (trial) =>
              Effect.tryPromise({
                try: () => trial.stamp(),
                catch: () => new ReplicaWorkerFailure({ message: UNOPENABLE_BACKUP_MESSAGE }),
              }),
            (trial) => Effect.tryPromise(() => trial.close()).pipe(Effect.ignore),
          );
          const current = yield* readReplicaFileSummary(local.databasePath);
          return { current: countsOf(current), backup: countsOf(backup) };
        }).pipe(
          Effect.onError(() => discardReplicaFile(stagedPath)),
          Effect.mapError(fileFailure),
        );

      const releaseForRestore = (
        local: Extract<WorkerBoot, { readonly authority: "local" }>,
        stagedPath: string,
      ) =>
        Effect.gen(function* () {
          const stamp = yield* withSession((current) => current.stamp());
          const closing = yield* Ref.getAndSet(live, undefined);
          if (closing !== undefined) {
            yield* Effect.tryPromise({ try: () => closing.close(), catch: workerFailure });
          }
          yield* settleReplicaFile(local.databasePath);
          yield* sealReplicaFile(stagedPath, stamp.localCommitVersion);
        }).pipe(Effect.mapError(fileFailure));

      return ReplicaWorkerRpcs.of({
        Engine: () => Effect.succeed(opened === undefined ? "unavailable" : "sqlite"),
        Stamp: () => withSession((current) => current.stamp()).pipe(Effect.map(stampOf)),
        ReadInsights: ({ window }) =>
          withSession((current) => current.readInsights(window)).pipe(
            Effect.map((read) => ({ stamp: stampOf(read.stamp), facts: read.facts })),
          ),
        ReadOutboxStatuses: () => withSession((current) => current.readOutboxStatuses()),
        EnqueueCommand: ({ request }) =>
          withSession((current) => current.enqueueCommand(request)).pipe(
            Effect.map((queued) => ({
              operationId: queued.operationId,
              status: queued.status,
              stamp: stampOf(queued.stamp),
            })),
          ),
        ReadCommandStatus: ({ operationId }) =>
          withSession((current) => current.readCommandStatus(operationId)).pipe(
            Effect.map((status) => status ?? null),
          ),
        SetForeground: ({ visible }) =>
          opened === undefined
            ? Effect.void
            : withSession((current) => link.setForeground(current, visible)),
        WakeSyncUpload: () =>
          opened === undefined
            ? Effect.succeed({ drained: false, drainCount: 0 })
            : withSession((current) => current.wakeSyncUpload()),
        BackUp: ({ destinationPath }) =>
          backUpReplicaFile({ databasePath: config.databasePath, destinationPath }).pipe(
            Effect.mapError(
              (failure) =>
                new ReplicaWorkerFailure({
                  message: `The backup could not be written. ${failure.message}`,
                }),
            ),
          ),
        StageRestore: ({ sourcePath, stagedPath }) => {
          switch (config.authority) {
            case "local":
              return stageRestore(config, sourcePath, stagedPath);
            case "remote":
              return Effect.fail(new ReplicaWorkerFailure({ message: LOCAL_ONLY_MESSAGE }));
          }
        },
        ReleaseForRestore: ({ stagedPath }) => {
          switch (config.authority) {
            case "local":
              return releaseForRestore(config, stagedPath);
            case "remote":
              return Effect.fail(new ReplicaWorkerFailure({ message: LOCAL_ONLY_MESSAGE }));
          }
        },
        Commits: () =>
          opened === undefined
            ? Stream.empty
            : Stream.callback<ReplicaCommitNotice>(
                (queue) =>
                  Effect.acquireRelease(
                    Effect.sync(() => opened.subscribe((notice) => offerCoalescing(queue, notice))),
                    (unsubscribe) => Effect.sync(unsubscribe),
                  ),
                { bufferSize: NOTICE_BUFFER_CAPACITY, strategy: "suspend" },
              ).pipe(
                Stream.map((notice) =>
                  Object.assign(
                    {
                      ...stampOf(notice),
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
        SyncHealth: () => SubscriptionRef.changes(syncHealth).pipe(Stream.changes),
        ProxyRequests: () => link.proxyRequests,
        ProxyRespond: ({ requestId, result }) => link.respondProxy(requestId, result),
        AccessTokenRequests: () => link.tokenRequests,
        AccessTokenRespond: ({ requestId, token }) => link.respondToken(requestId, token),
      });
    }),
  );
