import type { ReplicaSyncHealth, SqliteResultRow } from "@store/client-db";
import {
  LIVE_LONG_POLL_TIMEOUT_MILLIS,
  makeProxySyncTransport,
  openNodeReplicaSyncSession,
  type NodeReplicaSyncSession,
  type SyncProxyRequest,
} from "@store/client-db/node-sqlite";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  ReplicaWorkerFailure,
  ReplicaWorkerRpcs,
  type ProxyFetchRequest,
  type ProxyFetchResult,
  type ReplicaCommitNotice,
} from "./replica-rpc";

const toIpcRows = (
  rows: ReadonlyArray<SqliteResultRow>,
): ReadonlyArray<Record<string, string | number | null>> =>
  rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value instanceof Uint8Array ? Buffer.from(value).toString("base64") : value,
      ]),
    ),
  );

const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 103, 204, 205, 304]);

export const liveShimResponse = (result: ProxyFetchResult): Response => {
  const headers = new Headers({ "content-type": "application/json" });
  if (result.retryAfter !== undefined) headers.set("retry-after", result.retryAfter);
  return new Response(NULL_BODY_STATUSES.has(result.status) ? null : result.bodyText, {
    status: result.status,
    headers,
  });
};

const workerFailure = (cause: unknown) =>
  new ReplicaWorkerFailure({
    message: cause instanceof Error ? cause.message : "Replica worker failed.",
  });

export const makeReplicaWorkerHandlers = (openSession = openNodeReplicaSyncSession) =>
  ReplicaWorkerRpcs.toLayer(
    Effect.gen(function* () {
      const commits = yield* PubSub.unbounded<typeof ReplicaCommitNotice.Type>();
      const syncHealth = yield* SubscriptionRef.make<ReplicaSyncHealth>({ _tag: "running" });
      const proxyRequests = yield* Queue.unbounded<typeof ProxyFetchRequest.Type>();
      const proxyReplies = new Map<string, Deferred.Deferred<ProxyFetchResult>>();
      let session: NodeReplicaSyncSession | undefined;
      let unsubscribes: ReadonlyArray<() => void> = [];

      const closeSession = () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
        unsubscribes = [];
        Effect.runSync(SubscriptionRef.set(syncHealth, { _tag: "running" }));
        session?.close();
        session = undefined;
      };
      yield* Effect.addFinalizer(() => Effect.sync(closeSession));

      const proxyFetch = (request: SyncProxyRequest): Effect.Effect<ProxyFetchResult> => {
        const requestId = crypto.randomUUID();
        return Deferred.make<ProxyFetchResult>().pipe(
          Effect.tap((reply) => Effect.sync(() => proxyReplies.set(requestId, reply))),
          Effect.tap(() => Queue.offer(proxyRequests, { requestId, ...request })),
          Effect.flatMap(Deferred.await),
          Effect.ensuring(Effect.sync(() => proxyReplies.delete(requestId))),
        );
      };

      const withSession = <A>(use: (current: NodeReplicaSyncSession) => Promise<A>) =>
        Effect.suspend(() => {
          const current = session;
          if (current === undefined) {
            return Effect.fail(
              new ReplicaWorkerFailure({ message: "Replica worker is not booted." }),
            );
          }
          return Effect.tryPromise({ try: () => use(current), catch: workerFailure });
        });

      return ReplicaWorkerRpcs.of({
        Open: (boot) =>
          Effect.tryPromise(() => {
            closeSession();
            return openSession({
              path: boot.databasePath,
              identity: {
                organizationId: boot.organizationId,
                userId: boot.userId,
                replicaId: boot.replicaId,
              },
              databaseIdentity: boot.databasePath,
              transport: makeProxySyncTransport((request) =>
                Effect.runPromise(proxyFetch(request)),
              ),
              live: {
                apiBaseUrl: boot.apiBaseUrl,
                preferSse: false,
                fetch: async (input, init) => {
                  const request = new Request(input, init);
                  const url = new URL(request.url);
                  const method = request.method === "GET" ? "GET" : "POST";
                  const bodyText = method === "POST" ? await request.text() : null;
                  const result = await Effect.runPromise(
                    proxyFetch({
                      method,
                      pathname: url.pathname + url.search,
                      bodyText,
                      timeoutMillis: LIVE_LONG_POLL_TIMEOUT_MILLIS,
                    }),
                    { signal: request.signal },
                  );
                  return liveShimResponse(result);
                },
              },
            });
          }).pipe(
            Effect.map((opened) => {
              session = opened;
              unsubscribes = [
                opened.subscribe((notice) => {
                  PubSub.publishUnsafe(commits, {
                    generationId: notice.generationId,
                    localCommitVersion: notice.localCommitVersion,
                    touchedEntities: notice.touchedEntities,
                    touchedKeys: notice.touchedKeys,
                  });
                }),
                opened.subscribeSyncHealth((health) => {
                  Effect.runSync(SubscriptionRef.set(syncHealth, health));
                }),
              ];
              return "sqlite" as const;
            }),
            Effect.orElseSucceed(() => "unavailable" as const),
          ),
        Stamp: () =>
          withSession((current) => current.stamp()).pipe(
            Effect.map(({ generationId, localCommitVersion }) => ({
              generationId,
              localCommitVersion,
            })),
          ),
        ReadSubset: ({ spec }) =>
          withSession((current) => current.readSubset(spec)).pipe(
            Effect.map((read) => ({
              stamp: {
                generationId: read.stamp.generationId,
                localCommitVersion: read.stamp.localCommitVersion,
              },
              rows: toIpcRows(read.rows),
            })),
          ),
        ReadOutboxStatuses: () => withSession((current) => current.readOutboxStatuses()),
        ReadCommandAllocation: () => withSession((current) => current.readCommandAllocation()),
        EnqueueLocal: ({ envelope, createdAt }) =>
          withSession((current) => current.enqueueLocal(envelope, createdAt)),
        SetForeground: ({ visible }) =>
          session === undefined
            ? Effect.void
            : withSession(async (current) => {
                await current.setVisible(visible);
                if (visible) await current.wake("focus");
              }),
        WakeSyncUpload: () =>
          session === undefined
            ? Effect.succeed({ drained: false, drainCount: 0 })
            : withSession((current) => current.wakeSyncUpload()),
        Commits: () => Stream.fromPubSub(commits),
        SyncHealth: () => SubscriptionRef.changes(syncHealth),
        ProxyRequests: () => Stream.fromQueue(proxyRequests),
        ProxyRespond: ({ requestId, result }) =>
          Effect.suspend(() => {
            const reply = proxyReplies.get(requestId);
            return reply === undefined ? Effect.void : Deferred.succeed(reply, result);
          }).pipe(Effect.asVoid),
      });
    }),
  );
