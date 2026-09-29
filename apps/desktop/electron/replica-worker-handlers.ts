import type { ReplicaSyncHealth, SqliteResultRow } from "@store/client-db";
import {
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
  type AccessTokenRequest,
  type AccessTokenResult,
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
      const tokenRequests = yield* Queue.unbounded<typeof AccessTokenRequest.Type>();
      const tokenReplies = new Map<string, Deferred.Deferred<AccessTokenResult>>();
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

      const accessToken = (force: boolean): Effect.Effect<AccessTokenResult> => {
        const requestId = crypto.randomUUID();
        return Deferred.make<AccessTokenResult>().pipe(
          Effect.tap((reply) => Effect.sync(() => tokenReplies.set(requestId, reply))),
          Effect.tap(() => Queue.offer(tokenRequests, { requestId, force })),
          Effect.flatMap(Deferred.await),
          Effect.ensuring(Effect.sync(() => tokenReplies.delete(requestId))),
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
                accessToken: ({ force }) => Effect.runPromise(accessToken(force)),
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
        SummarizeSubset: ({ spec }) =>
          withSession((current) => current.summarizeSubset(spec)).pipe(
            Effect.map((read) => ({
              stamp: {
                generationId: read.stamp.generationId,
                localCommitVersion: read.stamp.localCommitVersion,
              },
              summary: read.summary,
            })),
          ),
        ReadInsights: ({ window }) =>
          withSession((current) => current.readInsights(window)).pipe(
            Effect.map((read) => ({
              stamp: {
                generationId: read.stamp.generationId,
                localCommitVersion: read.stamp.localCommitVersion,
              },
              facts: read.facts,
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
        AccessTokenRequests: () => Stream.fromQueue(tokenRequests),
        AccessTokenRespond: ({ requestId, token }) =>
          Effect.suspend(() => {
            const reply = tokenReplies.get(requestId);
            return reply === undefined ? Effect.void : Deferred.succeed(reply, token);
          }).pipe(Effect.asVoid),
      });
    }),
  );
