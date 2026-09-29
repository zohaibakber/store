import {
  AuthorityIncarnation,
  OPERATIONAL_SUBSCRIPTION,
  PARTITION_DIGEST_VERSION,
  PARTITION_ENTITIES,
  OrgCommitSequence,
  SnapshotId,
  SnapshotPartHash,
  STOCK_MOVEMENT_ROW_VERSION,
  syncProtocolError,
  type SnapshotManifest,
  type SnapshotPartPayload,
  type SnapshotRow,
  type SyncPullResult,
  type SyncTransactionGroup,
} from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_B,
} from "@store/contracts/sync/fixtures";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import type { SyncTransport } from "../../src/transport";
import { authorityDigest, commitToAuthority, type AuthorityPartition } from "./authority-digest";
import { FIXTURE_NOW } from "./pending-fixture";

const SNAPSHOT_PART_ROWS = 500;

const historyMetadata = (operationId: string) => ({
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  organizationId: LAST_UNIT_ORGANIZATION_ID,
  createdByUserId: "user-2",
  updatedByUserId: "user-2",
  deviceId: LAST_UNIT_REPLICA_B,
  operationId,
  rowVersion: 1,
});

const invoiceRow = (id: string, invoiceNumber: number, operationId: string) => ({
  id,
  invoiceNumber,
  customerName: null,
  total: 100,
  ...historyMetadata(operationId),
});

const invoiceItemRow = (id: string, invoiceId: string, operationId: string) => ({
  id,
  invoiceId,
  productId: LAST_UNIT_PRODUCT_ID,
  batchId: LAST_UNIT_BATCH_ID,
  productName: "Ten pack",
  batchNumber: "B-1",
  quantity: 1,
  quantityType: "unit",
  baseUnitQuantity: 1,
  salePrice: 100,
  ...historyMetadata(operationId),
});

const saleMovementRow = (id: string, invoiceId: string, operationId: string) => ({
  id,
  productId: LAST_UNIT_PRODUCT_ID,
  batchId: LAST_UNIT_BATCH_ID,
  invoiceId,
  type: "sale",
  packDelta: 0,
  unitDelta: -1,
  note: null,
  organizationId: LAST_UNIT_ORGANIZATION_ID,
  actorUserId: "user-2",
  deviceId: LAST_UNIT_REPLICA_B,
  operationId,
  createdAt: FIXTURE_NOW,
});

const saleGroup = (input: {
  readonly commitSequence: string;
  readonly operationId: string;
  readonly invoiceId: string;
  readonly invoiceNumber: number;
  readonly items: ReadonlyArray<{ readonly itemId: string; readonly movementId: string }>;
}): SyncTransactionGroup => ({
  commitSequence: OrgCommitSequence.make(input.commitSequence),
  operationId: input.operationId,
  decision: "accepted",
  changes: [
    {
      entity: "invoice",
      action: "upsert",
      entityId: input.invoiceId,
      rowVersion: 1,
      row: invoiceRow(input.invoiceId, input.invoiceNumber, input.operationId),
    },
    ...input.items.flatMap((item) => [
      {
        entity: "invoiceItem" as const,
        action: "upsert" as const,
        entityId: item.itemId,
        rowVersion: 1,
        row: invoiceItemRow(item.itemId, input.invoiceId, input.operationId),
      },
      {
        entity: "stockMovement" as const,
        action: "upsert" as const,
        entityId: item.movementId,
        rowVersion: STOCK_MOVEMENT_ROW_VERSION,
        row: saleMovementRow(item.movementId, input.invoiceId, input.operationId),
      },
    ]),
  ],
});

export const historicSales = (invoices: number, itemsPerInvoice: number) =>
  Array.makeBy(invoices, (index) =>
    saleGroup({
      commitSequence: "1",
      operationId: `historic-${index}`,
      invoiceId: `inv-${String(index).padStart(6, "0")}`,
      invoiceNumber: index + 1,
      items: Array.makeBy(itemsPerInvoice, (item) => ({
        itemId: `item-${String(index).padStart(6, "0")}-${item}`,
        movementId: `move-${String(index).padStart(6, "0")}-${item}`,
      })),
    }),
  );

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
  product: 1,
  batch: 2,
  invoice: 3,
  invoiceItem: 4,
  stockMovement: 5,
} as const;

const CATALOG_ENTITIES = new Set(["category", "product", "batch"]);

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
