import type { ReplicaSyncHealth, SqliteResultRow } from "@store/client-db";
import {
  makeProxySyncTransport,
  openNodeReplicaSyncSession,
  type NodeReplicaSyncSession,
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

      const proxyFetch = (
        method: "GET" | "POST",
        pathname: string,
        bodyText: string | null,
      ): Effect.Effect<ProxyFetchResult> => {
        const requestId = crypto.randomUUID();
        return Deferred.make<ProxyFetchResult>().pipe(
          Effect.tap((reply) => Effect.sync(() => proxyReplies.set(requestId, reply))),
          Effect.tap(() => Queue.offer(proxyRequests, { requestId, method, pathname, bodyText })),
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
              transport: makeProxySyncTransport((method, pathname, bodyText) =>
                Effect.runPromise(proxyFetch(method, pathname, bodyText)),
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
                    proxyFetch(method, url.pathname + url.search, bodyText),
                    { signal: request.signal },
                  );
                  return new Response(result.bodyText, {
                    status: result.status,
                    headers: { "content-type": "application/json" },
                  });
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
