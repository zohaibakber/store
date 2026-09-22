import { parentPort } from "node:worker_threads";

import type { SqliteResultRow } from "@store/client-db";
import {
  makeProxySyncTransport,
  openNodeReplicaSyncSession,
  type NodeReplicaSyncSession,
} from "@store/client-db/node-sqlite";

import type { ReplicaWorkerRequest, ReplicaWorkerResponse } from "./replica-channels";

const reply = (message: ReplicaWorkerResponse) => {
  parentPort?.postMessage(message);
};

const toIpcRows = (
  rows: ReadonlyArray<SqliteResultRow>,
): ReadonlyArray<Record<string, string | number | null>> =>
  rows.map((row) => {
    const next: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(row)) {
      next[key] = value instanceof Uint8Array ? Buffer.from(value).toString("base64") : value;
    }
    return next;
  });

const pendingProxy = new Map<
  string,
  {
    readonly resolve: (value: {
      readonly ok: boolean;
      readonly status: number;
      readonly bodyText: string;
    }) => void;
  }
>();

const proxyFetch = (
  method: "GET" | "POST",
  pathname: string,
  bodyText: string | null,
): Promise<{ readonly ok: boolean; readonly status: number; readonly bodyText: string }> =>
  new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    pendingProxy.set(requestId, { resolve });
    reply({ _tag: "proxyFetch", requestId, method, pathname, bodyText });
  });

let session: NodeReplicaSyncSession | undefined;
let unsubscribeCommits: (() => void) | undefined;
let bootEngine: "sqlite" | "unavailable" = "unavailable";

parentPort?.on("message", (raw: ReplicaWorkerRequest) => {
  void (async () => {
    try {
      if (raw._tag === "proxyFetchResult") {
        const pending = pendingProxy.get(raw.requestId);
        if (!pending) return;
        pendingProxy.delete(raw.requestId);
        pending.resolve({ ok: raw.ok, status: raw.status, bodyText: raw.bodyText });
        return;
      }
      switch (raw._tag) {
        case "boot": {
          unsubscribeCommits?.();
          unsubscribeCommits = undefined;
          session?.close();
          session = undefined;
          try {
            const opened = await openNodeReplicaSyncSession({
              path: raw.databasePath,
              identity: {
                organizationId: raw.organizationId,
                userId: raw.userId,
                replicaId: raw.replicaId,
              },
              databaseIdentity: raw.databasePath,
              transport: makeProxySyncTransport(proxyFetch),
              live: {
                apiBaseUrl: raw.apiBaseUrl,
                preferSse: false,
                fetch: async (input, init) => {
                  const request = new Request(input, init);
                  const method = request.method === "GET" ? "GET" : "POST";
                  const pathname = new URL(request.url).pathname + new URL(request.url).search;
                  const bodyText = method === "POST" ? await request.text() : null;
                  const result = await proxyFetch(method, pathname, bodyText);
                  return new Response(result.bodyText, {
                    status: result.status,
                    headers: { "content-type": "application/json" },
                  });
                },
              },
            });
            session = opened;
            bootEngine = "sqlite";
            unsubscribeCommits = opened.subscribe((notice) => {
              reply({
                _tag: "commit",
                generationId: notice.generationId,
                localCommitVersion: notice.localCommitVersion,
                touchedEntities: notice.touchedEntities,
                touchedKeys: notice.touchedKeys,
              });
            });
            reply({ _tag: "ready", requestId: raw.requestId, engine: "sqlite" });
          } catch {
            bootEngine = "unavailable";
            reply({
              _tag: "ready",
              requestId: raw.requestId,
              engine: "unavailable",
            });
          }
          return;
        }
        case "stamp": {
          if (!session) {
            reply({
              _tag: "error",
              requestId: raw.requestId,
              message: "Replica worker is not booted.",
            });
            return;
          }
          const stamp = session.stamp();
          reply({
            _tag: "stamp",
            requestId: raw.requestId,
            generationId: stamp.generationId,
            localCommitVersion: stamp.localCommitVersion,
          });
          return;
        }
        case "query": {
          if (!session) {
            reply({
              _tag: "error",
              requestId: raw.requestId,
              message: "Replica worker is not booted.",
            });
            return;
          }
          if (raw.stamped) {
            const result = session.queryStamped(raw.sql, raw.parameters);
            reply({
              _tag: "query",
              requestId: raw.requestId,
              rows: toIpcRows(result.rows),
              stamp: {
                generationId: result.stamp.generationId,
                localCommitVersion: result.stamp.localCommitVersion,
              },
            });
            return;
          }
          reply({
            _tag: "query",
            requestId: raw.requestId,
            rows: toIpcRows(session.query(raw.sql, raw.parameters)),
          });
          return;
        }
        case "wake": {
          if (!session || bootEngine !== "sqlite") {
            reply({
              _tag: "woke",
              requestId: raw.requestId,
              drained: false,
              drainCount: 0,
            });
            return;
          }
          const woke = await session.wakeSyncUpload();
          reply({
            _tag: "woke",
            requestId: raw.requestId,
            drained: woke.drained,
            drainCount: woke.drainCount,
          });
          return;
        }
        case "dispose": {
          unsubscribeCommits?.();
          unsubscribeCommits = undefined;
          session?.close();
          session = undefined;
          reply({ _tag: "disposed", requestId: raw.requestId });
          return;
        }
      }
    } catch (cause) {
      reply({
        _tag: "error",
        requestId: "requestId" in raw ? raw.requestId : undefined,
        message: cause instanceof Error ? cause.message : "Replica worker failed.",
      });
    }
  })();
});
