import { CommandStatus, DecimalSequence, SyncCommandEnvelope, SyncEntity } from "@store/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { createReplicaCommitPublisher } from "./publisher";
import { decodeSqliteResultRow } from "./sqlite-row";
import type { ReplicaSyncHealth } from "./status";
import type { InventorySubsetSpec } from "./subset-spec";
import type { ReplicaHandle, ReplicaQueryStamp } from "./types";

export type ElectronReplicaOpenIdentity = {
  readonly organizationId: string;
  readonly userId: string;
  readonly replicaId: string;
};

type CommitStamp = {
  readonly generationId: string;
  readonly localCommitVersion: number;
};

export type ElectronReplicaBridge = {
  readonly open: (
    identity: ElectronReplicaOpenIdentity,
  ) => Promise<{ readonly workspaceToken: string; readonly engine: "sqlite" | "unavailable" }>;
  readonly close: (workspaceToken: string) => Promise<void>;
  readonly stamp: (workspaceToken: string) => Promise<CommitStamp>;
  readonly readSubset: (input: {
    readonly workspaceToken: string;
    readonly spec: InventorySubsetSpec;
  }) => Promise<{
    readonly rows: ReadonlyArray<Record<string, string | number | null>>;
    readonly stamp: CommitStamp;
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
  readonly onSyncHealth: (
    workspaceToken: string,
    callback: (health: ReplicaSyncHealth) => void,
  ) => () => void;
  readonly readOutboxStatuses: (workspaceToken: string) => Promise<ReadonlyArray<string>>;
  readonly readCommandAllocation: (workspaceToken: string) => Promise<{
    readonly epoch: string;
    readonly nextClientSequence: string;
  }>;
  readonly enqueueLocal: (input: {
    readonly workspaceToken: string;
    readonly envelope: typeof SyncCommandEnvelope.Encoded;
    readonly createdAt: number;
  }) => Promise<{
    readonly changed: boolean;
    readonly status: string;
  }>;
  readonly wakeSyncUpload: (workspaceToken: string) => Promise<{
    readonly drained: boolean;
    readonly drainCount: number;
  }>;
};

const decodeSyncEntity = Schema.decodeUnknownOption(SyncEntity);
const decodeCommandStatus = Schema.decodeUnknownOption(CommandStatus);
const encodeEnvelope = Schema.encodeSync(SyncCommandEnvelope);
const decodeCommandAllocation = Schema.decodeUnknownSync(
  Schema.Struct({ epoch: DecimalSequence, nextClientSequence: DecimalSequence }),
);

const decodedSome = <A>(
  values: ReadonlyArray<string>,
  decode: (value: string) => Option.Option<A>,
) => values.flatMap((value) => Option.toArray(decode(value)));

export const openElectronIpcReplicaHandle = async (
  bridge: ElectronReplicaBridge,
  identity: ElectronReplicaOpenIdentity,
): Promise<ReplicaHandle> => {
  const opened = await bridge.open(identity);
  const { workspaceToken } = opened;
  if (opened.engine !== "sqlite") {
    await bridge.close(workspaceToken).catch(() => undefined);
    throw new Error("Native Electron replica SQLite is unavailable.");
  }

  const publisher = createReplicaCommitPublisher();

  const unsubscribe = bridge.onCommit((event) => {
    if (event.workspaceToken !== workspaceToken) return;
    publisher.publish({
      workspaceToken,
      generationId: event.generationId,
      localCommitVersion: event.localCommitVersion,
      touchedEntities: decodedSome(event.touchedEntities, decodeSyncEntity),
      touchedKeys: event.touchedKeys,
    });
  });

  const workspaceStamp = (value: CommitStamp): ReplicaQueryStamp => ({
    workspaceToken,
    generationId: value.generationId,
    localCommitVersion: value.localCommitVersion,
  });

  return {
    workspaceToken,
    engine: "sqlite",
    stamp: async () => workspaceStamp(await bridge.stamp(workspaceToken)),
    readSubset: async (spec) => {
      const result = await bridge.readSubset({ workspaceToken, spec });
      return {
        stamp: workspaceStamp(result.stamp),
        rows: result.rows.map((row) => decodeSqliteResultRow(row)),
      };
    },
    readOutboxStatuses: async () =>
      decodedSome(await bridge.readOutboxStatuses(workspaceToken), decodeCommandStatus),
    readCommandAllocation: async () =>
      decodeCommandAllocation(await bridge.readCommandAllocation(workspaceToken)),
    enqueueLocal: (envelope, createdAt) =>
      bridge.enqueueLocal({ workspaceToken, envelope: encodeEnvelope(envelope), createdAt }),
    subscribe: publisher.subscribe,
    publish: publisher.publish,
    subscribeSyncHealth: (listener) => bridge.onSyncHealth(workspaceToken, listener),
    wakeSyncUpload: () => {
      void bridge.wakeSyncUpload(workspaceToken);
    },
    close: () => {
      unsubscribe();
      publisher.dispose();
      void bridge.close(workspaceToken).catch(() => undefined);
    },
  };
};
