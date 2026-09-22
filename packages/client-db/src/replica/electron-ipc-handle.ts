import { SyncEntity as SyncEntitySchema } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { openReplicaHandleScope } from "./handle-scope";
import { createReplicaCommitPublisher } from "./publisher";
import { decodeSqliteResultRow } from "./sqlite-row";
import type {
  ReplicaCommitNotice,
  ReplicaHandle,
  ReplicaQueryStamp,
  SqliteParameter,
  SqliteResultRow,
} from "./types";

export type ElectronReplicaOpenIdentity = {
  readonly organizationId: string;
  readonly userId: string;
  readonly replicaId: string;
};

type ReplicaBridge = {
  readonly open: (input: {
    readonly organizationId: string;
    readonly userId: string;
    readonly replicaId: string;
    readonly requestId: string;
  }) => Promise<{ readonly workspaceToken: string; readonly engine: "sqlite" | "unavailable" }>;
  readonly close: (workspaceToken: string) => Promise<void>;
  readonly stamp: (workspaceToken: string) => Promise<{
    readonly workspaceToken: string;
    readonly generationId: string;
    readonly localCommitVersion: number;
  }>;
  readonly query: (input: {
    readonly workspaceToken: string;
    readonly sql: string;
    readonly parameters: ReadonlyArray<string | number | null>;
    readonly stamped?: boolean;
  }) => Promise<{
    readonly rows: ReadonlyArray<Record<string, string | number | null>>;
    readonly stamp?: {
      readonly generationId: string;
      readonly localCommitVersion: number;
    };
  }>;
  readonly onCommit: (
    callback: (event: {
      readonly workspaceToken: string;
      readonly generationId: string;
      readonly localCommitVersion: number;
      readonly touchedEntities: ReadonlyArray<string>;
      readonly touchedKeys: ReadonlyArray<string>;
    }) => void,
  ) => () => void;
  readonly wakeSyncUpload: (workspaceToken: string) => Promise<{
    readonly workspaceToken: string;
    readonly drained: boolean;
    readonly drainCount: number;
  }>;
};

const isBigIntParameter = (value: SqliteParameter): value is bigint => typeof value === "bigint";

const toIpcParameter = (value: SqliteParameter): string | number | null => {
  if (value instanceof Uint8Array) {
    throw new Error("Binary SQLite parameters are not supported over Electron replica IPC.");
  }
  if (isBigIntParameter(value)) return Number(value);
  return value;
};

const decodeSyncEntity = Schema.decodeUnknownOption(SyncEntitySchema);

export const openElectronIpcReplicaHandle = async (
  bridge: ReplicaBridge,
  identity: ElectronReplicaOpenIdentity,
): Promise<ReplicaHandle> => {
  const lifetime = openReplicaHandleScope();

  const requestId = crypto.randomUUID();
  const opened = await bridge.open({
    organizationId: identity.organizationId,
    userId: identity.userId,
    replicaId: identity.replicaId,
    requestId,
  });
  if (opened.engine !== "sqlite") {
    await bridge.close(opened.workspaceToken).catch(() => undefined);
    throw new Error("Native Electron replica SQLite is unavailable.");
  }

  await lifetime.addFinalizer(Effect.promise(() => bridge.close(opened.workspaceToken)));

  const publisher = createReplicaCommitPublisher();
  lifetime.addSyncFinalizer(() => {
    publisher.dispose();
  });

  const unsubscribe = bridge.onCommit((event) => {
    if (event.workspaceToken !== opened.workspaceToken) return;
    const touchedEntities = event.touchedEntities.flatMap((value) => {
      const decoded = decodeSyncEntity(value);
      return Option.isSome(decoded) ? [decoded.value] : [];
    });
    const notice: ReplicaCommitNotice = {
      workspaceToken: event.workspaceToken,
      generationId: event.generationId,
      localCommitVersion: event.localCommitVersion,
      touchedEntities,
      touchedKeys: event.touchedKeys,
    };
    publisher.publish(notice);
  });
  lifetime.addSyncFinalizer(() => {
    unsubscribe();
  });

  const stamp = async (): Promise<ReplicaQueryStamp> => {
    const value = await bridge.stamp(opened.workspaceToken);
    return {
      workspaceToken: opened.workspaceToken,
      generationId: value.generationId,
      localCommitVersion: value.localCommitVersion,
    };
  };

  const query = async (
    sql: string,
    parameters: ReadonlyArray<SqliteParameter>,
  ): Promise<ReadonlyArray<SqliteResultRow>> => {
    const result = await bridge.query({
      workspaceToken: opened.workspaceToken,
      sql,
      parameters: parameters.map(toIpcParameter),
    });
    return result.rows.map((row) => decodeSqliteResultRow(row));
  };

  return {
    workspaceToken: opened.workspaceToken,
    engine: "sqlite",
    stamp,
    query,
    queryStamped: async (sql, parameters) => {
      const result = await bridge.query({
        workspaceToken: opened.workspaceToken,
        sql,
        parameters: parameters.map(toIpcParameter),
        stamped: true,
      });
      const queryStamp = result.stamp ?? (await stamp());
      return {
        stamp: {
          workspaceToken: opened.workspaceToken,
          generationId: queryStamp.generationId,
          localCommitVersion: queryStamp.localCommitVersion,
        },
        rows: result.rows.map((row) => decodeSqliteResultRow(row)),
      };
    },
    subscribe: publisher.subscribe,
    publish: publisher.publish,
    wakeSyncUpload: () => {
      void bridge.wakeSyncUpload(opened.workspaceToken);
    },
    close: lifetime.close,
  };
};
