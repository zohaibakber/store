import {
  NOTICE_BUFFER_CAPACITY,
  offerCoalescing,
  type ReplicaCommitNotice,
  type ReplicaSyncHealth,
} from "@store/client-db";
import {
  makeProxySyncTransport,
  openNodeReplicaSyncSession,
  type NodeReplicaSyncSession,
  type SyncProxyRequest,
} from "@store/client-db/node-sqlite";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
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

export const makeReplicaWorkerHandlers = <R>(
  boot: Effect.Effect<typeof ReplicaWorkerBoot.Type, unknown, R>,
  openSession = openNodeReplicaSyncSession,
) =>
  ReplicaWorkerRpcs.toLayer(
    Effect.gen(function* () {
      const config = yield* boot;
      const syncHealth = yield* SubscriptionRef.make<ReplicaSyncHealth>({ _tag: "running" });
      const proxyRequests =
        yield* Queue.bounded<typeof ProxyFetchRequest.Type>(PROXY_QUEUE_CAPACITY);
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

      const opened = yield* Effect.acquireRelease(
        Effect.tryPromise(() =>
          openSession({
            path: config.databasePath,
            identity: {
              organizationId: config.organizationId,
              userId: config.userId,
              replicaId: config.replicaId,
            },
            databaseIdentity: config.databasePath,
            transport: makeProxySyncTransport((request) => Effect.runPromise(proxyFetch(request))),
            live: {
              apiBaseUrl: config.apiBaseUrl,
              accessToken: ({ force }) =>
                Effect.runPromise(sharedToken(force, null, TOKEN_REPLY_LIMIT)),
            },
          }),
        ).pipe(
          Effect.map((session): NodeReplicaSyncSession | undefined => session),
          Effect.orElseSucceed((): NodeReplicaSyncSession | undefined => undefined),
        ),
        (session) =>
          session === undefined
            ? Effect.void
            : Effect.promise(() => session.close()).pipe(Effect.ignore),
      );

      if (opened !== undefined) {
        const unsubscribe = opened.subscribeSyncHealth((health) => {
          Effect.runSync(SubscriptionRef.set(syncHealth, health));
        });
        yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
      }

      const withSession = <A>(use: (current: NodeReplicaSyncSession) => Promise<A>) =>
        opened === undefined
          ? Effect.fail(new ReplicaWorkerFailure({ message: "Replica worker is not booted." }))
          : Effect.tryPromise({ try: () => use(opened), catch: workerFailure });

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
            : withSession(async (current) => {
                await current.setVisible(visible);
                if (visible) await current.wake("focus");
              }),
        WakeSyncUpload: () =>
          opened === undefined
            ? Effect.succeed({ drained: false, drainCount: 0 })
            : withSession((current) => current.wakeSyncUpload()),
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
        SyncHealth: () => SubscriptionRef.changes(syncHealth),
        ProxyRequests: () => Stream.fromQueue(proxyRequests),
        ProxyRespond: ({ requestId, result }) => proxyReplies.respond(requestId, result),
        AccessTokenRequests: () => Stream.fromQueue(tokenRequests),
        AccessTokenRespond: ({ requestId, token }) => tokenReplies.respond(requestId, token),
      });
    }),
  );
