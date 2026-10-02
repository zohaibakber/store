import {
  AuthorityIncarnation,
  OPERATIONAL_SUBSCRIPTION,
  PARTITION_DIGEST_VERSION,
  PARTITION_ENTITIES,
  OrgCommitSequence,
  SnapshotId,
  SnapshotPartHash,
  syncProtocolError,
  type SnapshotManifest,
  type SnapshotPartPayload,
  type SnapshotRow,
  type SyncEntity,
  type SyncPullResult,
  type SyncTransactionGroup,
} from "@store/contracts";
import { LAST_UNIT_EPOCH } from "@store/contracts/sync/fixtures";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import type { SyncTransport } from "../../src/transport";
import { authorityDigest, commitToAuthority, type AuthorityPartition } from "./authority-digest";

const SNAPSHOT_PART_ROWS = 500;

type HistoryAuthority = {
  readonly partition: AuthorityPartition;
  readonly log: Ref.Ref<ReadonlyArray<SyncTransactionGroup>>;
  readonly snapshotParts: Ref.Ref<ReadonlyMap<number, SnapshotPartPayload>>;
};

export const makeHistoryAuthority = Effect.fn("HistoryAuthority.make")(function* (
  history: ReadonlyArray<SyncTransactionGroup>,
  log: ReadonlyArray<SyncTransactionGroup>,
) {
  const partition: AuthorityPartition = new Map();
  for (const group of [...history, ...log]) commitToAuthority(partition, group);
  return {
    partition,
    log: yield* Ref.make(log),
    snapshotParts: yield* Ref.make<ReadonlyMap<number, SnapshotPartPayload>>(new Map()),
  } satisfies HistoryAuthority;
});

const headOf = (log: ReadonlyArray<SyncTransactionGroup>) =>
  log.at(-1)?.commitSequence ?? OrgCommitSequence.make("0");

const dependencyRank = {
  category: 0,
  supplier: 1,
  product: 2,
  batch: 3,
  purchaseOrder: 4,
  purchaseOrderItem: 5,
  invoice: 6,
  invoiceItem: 7,
  stockMovement: 8,
} as const satisfies Record<SyncEntity, number>;

const CATALOG_ENTITIES: ReadonlySet<SyncEntity> = new Set([
  "category",
  "supplier",
  "product",
  "batch",
  "purchaseOrder",
  "purchaseOrderItem",
]);

const snapshotManifest = (authority: HistoryAuthority, horizon: OrgCommitSequence) =>
  Effect.gen(function* () {
    const rows = [...authority.partition.values()].sort(
      (left, right) =>
        dependencyRank[left.entity] - dependencyRank[right.entity] ||
        (left.entityId < right.entityId ? -1 : left.entityId > right.entityId ? 1 : 0),
    );
    const catalogRows = rows.filter((row) => CATALOG_ENTITIES.has(row.entity));
    const historyRows = rows.filter((row) => !CATALOG_ENTITIES.has(row.entity));
    const chunks: ReadonlyArray<ReadonlyArray<SnapshotRow>> = [
      ...(catalogRows.length === 0 ? [[]] : Array.chunksOf(catalogRows, SNAPSHOT_PART_ROWS)),
      ...Array.chunksOf(historyRows, SNAPSHOT_PART_ROWS),
    ];
    const snapshotId = SnapshotId.make(`snapshot-${horizon}`);
    const parts = new Map(
      chunks.map((chunk, index) => [
        index + 1,
        { snapshotId, partNumber: index + 1, rows: chunk } satisfies SnapshotPartPayload,
      ]),
    );
    yield* Ref.set(authority.snapshotParts, parts);
    return {
      snapshotId,
      epoch: LAST_UNIT_EPOCH,
      subscription: OPERATIONAL_SUBSCRIPTION,
      schemaVersion: 1,
      horizon,
      parts: [...parts.keys()].map((partNumber) => ({
        partNumber,
        byteLength: 1,
        sha256: SnapshotPartHash.make("a".repeat(64)),
      })),
      entityCounts: PARTITION_ENTITIES.map((entity) => ({
        entity,
        rowCount: rows.filter((row) => row.entity === entity).length,
      })),
      digestVersion: PARTITION_DIGEST_VERSION,
    } satisfies SnapshotManifest;
  });

export const historyAuthorityTransport = (
  authority: HistoryAuthority,
  incarnation: string,
): SyncTransport => ({
  registerReplica: () => Effect.die("unused"),
  submitCommand: () => Effect.die("unused"),
  getReceipt: () => Effect.succeed(undefined),
  pull: (request) =>
    Effect.gen(function* () {
      const log = yield* Ref.get(authority.log);
      const transactions = log.filter(
        (group) => BigInt(group.commitSequence) > BigInt(request.afterCommitSequence),
      );
      const head = headOf(log);
      const page: SyncPullResult = {
        epoch: LAST_UNIT_EPOCH,
        incarnation: AuthorityIncarnation.make(incarnation),
        subscription: OPERATIONAL_SUBSCRIPTION,
        schemaVersion: 1,
        transactions,
        nextCommitSequence: head,
        horizon: head,
        retentionFloor: OrgCommitSequence.make("0"),
      };
      if (request.digestVersion === undefined) return page;
      return { ...page, digest: yield* authorityDigest(authority.partition) };
    }),
  acquireSnapshot: () =>
    Effect.gen(function* () {
      const manifest = yield* snapshotManifest(authority, headOf(yield* Ref.get(authority.log)));
      return { _tag: "ready" as const, manifest };
    }),
  readSnapshotPart: (_snapshotId, partNumber) =>
    Effect.gen(function* () {
      const part = (yield* Ref.get(authority.snapshotParts)).get(partNumber);
      if (part === undefined) {
        return yield* Effect.fail(syncProtocolError("SNAPSHOT_UNAVAILABLE", "missing part"));
      }
      return part;
    }),
});
