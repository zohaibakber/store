import { replicaMigrations } from "@store/db/replica/migrations";
import { runMigrationsAsync } from "@store/sync/migrations";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { createReplicaCommitPublisher } from "./publisher";
import { decodeReplicaStampRow } from "./sqlite-row";
import type {
  ReplicaQueryStamp,
  ReplicaSqliteHandle,
  SqliteParameter,
  SqliteResultRow,
} from "./types";
import {
  ReplicaWorkerRequest,
  ReplicaWorkerResponse,
  workerParameters,
} from "./wa-sqlite-protocol";
import {
  openWaSqliteSession,
  type WaSqliteSession,
  type WaSqliteVfsKind,
} from "./wa-sqlite-session";

type ReplicaSqlClient = {
  readonly query: (
    sql: string,
    parameters: ReadonlyArray<SqliteParameter>,
  ) => Promise<ReadonlyArray<SqliteResultRow>>;
  readonly close: () => Promise<void>;
};

const canOpenDedicatedWorker = (
  worker: typeof globalThis.Worker,
  indexedDb: typeof globalThis.indexedDB,
): boolean => worker !== undefined && indexedDb !== undefined;

const migrateAndSeed = async (client: ReplicaSqlClient, databaseName: string): Promise<void> => {
  await runMigrationsAsync(replicaMigrations, {
    execute: async (sql, parameters) => {
      await client.query(sql, parameters);
    },
    appliedKeys: async (sql) => {
      const rows = await client.query(sql, []);
      return rows.flatMap((row) => {
        const key = row["key"];
        return Schema.is(Schema.String)(key) ? [key] : [];
      });
    },
  });
  const existing = await client.query(`select id from replica_state where id = 'singleton'`, []);
  if (existing.length > 0) return;
  await client.query(
    `insert into replica_state (
      id, organizationId, userId, replicaId, epoch, incarnation,
      appliedCommitSequence, nextClientSequence, localCommitVersion, activeGeneration
    ) values ('singleton', 'pending', 'pending', ?, '1', 'local', '0', '1', 0, 1)`,
    [databaseName],
  );
};

const readStamp = async (
  client: ReplicaSqlClient,
  workspaceToken: string,
): Promise<ReplicaQueryStamp> => {
  const rows = await client.query(
    `select activeGeneration as generation, localCommitVersion as version from replica_state where id = 'singleton'`,
    [],
  );
  const decoded = decodeReplicaStampRow(rows[0]);
  return {
    workspaceToken,
    generationId: String(decoded.generation),
    localCommitVersion: decoded.version,
  };
};

const openSessionClient = async (
  databaseName: string,
  vfsKind: WaSqliteVfsKind,
): Promise<ReplicaSqlClient> => {
  const session: WaSqliteSession = await openWaSqliteSession(databaseName, vfsKind);
  return {
    query: session.query,
    close: session.close,
  };
};

type PendingWorkerCall = {
  readonly resolve: (response: ReplicaWorkerResponse) => void;
  readonly reject: (error: Error) => void;
};

const openWorkerClient = (databaseName: string): Promise<ReplicaSqlClient> => {
  const WorkerConstructor = globalThis.Worker;
  if (!canOpenDedicatedWorker(WorkerConstructor, globalThis.indexedDB)) {
    return Promise.reject(new Error("Browser worker SQLite requires Worker and IndexedDB."));
  }
  const worker = new WorkerConstructor(new URL("./wa-sqlite.worker.ts", import.meta.url), {
    type: "module",
  });
  let nextRequestId = 1;
  const pending = new Map<number, PendingWorkerCall>();
  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const response = Schema.decodeUnknownOption(ReplicaWorkerResponse)(event.data);
    if (Option.isNone(response)) return;
    const waiter = pending.get(response.value.requestId);
    if (!waiter) return;
    pending.delete(response.value.requestId);
    waiter.resolve(response.value);
  });
  worker.addEventListener("error", () => {
    for (const waiter of pending.values()) {
      waiter.reject(new Error("Replica SQLite worker failed."));
    }
    pending.clear();
  });
  const call = (request: ReplicaWorkerRequest): Promise<ReplicaWorkerResponse> =>
    new Promise<ReplicaWorkerResponse>((resolve, reject) => {
      pending.set(request.requestId, { resolve, reject });
      worker.postMessage(request);
    });
  const request = async (
    build: (requestId: number) => ReplicaWorkerRequest,
  ): Promise<ReplicaWorkerResponse> => {
    const requestId = nextRequestId;
    nextRequestId += 1;
    const response = await call(build(requestId));
    if (response._tag === "error") throw new Error(response.message);
    return response;
  };
  return request((requestId) => ({
    _tag: "open",
    requestId,
    databaseName,
  })).then(() => ({
    query: async (sql, parameters) => {
      const response = await request((requestId) => ({
        _tag: "query",
        requestId,
        sql,
        parameters: workerParameters(parameters),
      }));
      if (response._tag !== "rows") {
        throw new Error("Replica SQLite worker did not return rows.");
      }
      return response.rows;
    },
    close: async () => {
      await request((requestId) => ({ _tag: "close", requestId }));
      worker.terminate();
    },
  }));
};

const openHandle = async (
  client: ReplicaSqlClient,
  databaseName: string,
): Promise<ReplicaSqliteHandle> => {
  await migrateAndSeed(client, databaseName);
  const workspaceToken = crypto.randomUUID();
  const publisher = createReplicaCommitPublisher();
  return {
    workspaceToken,
    stamp: () => readStamp(client, workspaceToken),
    query: client.query,
    subscribe: publisher.subscribe,
    publish: publisher.publish,
    close: () => {
      publisher.dispose();
      void client.close();
    },
  };
};

export const openElectronBrowserWorkerReplicaSqlite = (
  databaseName: string,
): Promise<ReplicaSqliteHandle> => {
  if (canOpenDedicatedWorker(globalThis.Worker, globalThis.indexedDB)) {
    return openWorkerClient(databaseName).then((client) => openHandle(client, databaseName));
  }
  return openSessionClient(databaseName, "memory").then((client) =>
    openHandle(client, databaseName),
  );
};
