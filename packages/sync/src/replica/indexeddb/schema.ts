import * as IndexedDbDatabase from "@effect/platform-browser/IndexedDbDatabase";
import type * as IndexedDbQueryBuilder from "@effect/platform-browser/IndexedDbQueryBuilder";
import * as IndexedDbTable from "@effect/platform-browser/IndexedDbTable";
import * as IndexedDbVersion from "@effect/platform-browser/IndexedDbVersion";
import {
  CommandStatus,
  ReplicaBatchRow,
  ReplicaCategoryRow,
  ReplicaInvoiceItemRow,
  ReplicaInvoiceRow,
  ReplicaProductRow,
  ReplicaStockMovementRow,
} from "@store/contracts/sync/replica-model";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
const NonNegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const PositiveInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
const SignedInteger = Schema.Number.check(Schema.isInt());

const withGeneration = <A extends Schema.Struct.Fields>(fields: A) =>
  Schema.Struct({
    generation: PositiveInteger,
    ...fields,
  });

export const ReplicaStateRow = Schema.Struct({
  id: NonEmptyString,
  organizationId: NonEmptyString,
  userId: NonEmptyString,
  replicaId: NonEmptyString,
  epoch: NonEmptyString,
  incarnation: NonEmptyString,
  appliedCommitSequence: NonEmptyString,
  nextClientSequence: NonEmptyString,
  localCommitVersion: NonNegativeInteger,
  activeGeneration: PositiveInteger,
  caughtUpAt: Schema.optionalKey(NonNegativeInteger),
  registeredAt: Schema.optionalKey(NonNegativeInteger),
});
export type ReplicaStateRow = typeof ReplicaStateRow.Type;

export const OutboxRow = Schema.Struct({
  operationId: NonEmptyString,
  status: CommandStatus,
  envelopeJson: NonEmptyString,
  receiptJson: Schema.NullOr(NonEmptyString),
  clientSequence: NonEmptyString,
  clientSequenceLength: NonNegativeInteger,
  clientSequenceDigits: NonEmptyString,
  createdAt: NonNegativeInteger,
  claimId: Schema.NullOr(NonEmptyString),
  claimedAt: Schema.NullOr(NonNegativeInteger),
  attempts: NonNegativeInteger,
  outcomeUncertain: Schema.Boolean,
  commitSequence: Schema.NullOr(NonEmptyString),
});
export type OutboxRow = typeof OutboxRow.Type;

export const CoverageRow = Schema.Struct({
  subscription: NonEmptyString,
  state: Schema.Literals(["awaiting_snapshot", "downloaded"]),
  throughCommitSequence: Schema.NullOr(NonEmptyString),
  digest: Schema.NullOr(NonEmptyString),
  verifiedAt: Schema.optionalKey(Schema.NullOr(NonNegativeInteger)),
});

export const SnapshotImportRow = Schema.Struct({
  snapshotId: NonEmptyString,
  generation: PositiveInteger,
  subscription: NonEmptyString,
  horizon: NonEmptyString,
  stage: Schema.Literals(["importing", "caught_up", "activated", "failed"]),
  partsImported: NonNegativeInteger,
  partsTotal: NonNegativeInteger,
});

export const StockOverlayRow = Schema.Struct({
  commandId: NonEmptyString,
  batchId: NonEmptyString,
  packDelta: SignedInteger,
  unitDelta: SignedInteger,
});

export const PendingRowMark = Schema.Struct({
  entity: NonEmptyString,
  entityId: NonEmptyString,
  operationId: NonEmptyString,
});
export type PendingRowMark = typeof PendingRowMark.Type;

export const PendingRowJournalEntry = Schema.Struct({
  operationId: NonEmptyString,
  entity: NonEmptyString,
  entityId: NonEmptyString,
  priorRowJson: Schema.NullOr(NonEmptyString),
});
export type PendingRowJournalEntry = typeof PendingRowJournalEntry.Type;

export const StagedSnapshotRow = Schema.Struct({
  snapshotId: NonEmptyString,
  entity: NonEmptyString,
  entityId: NonEmptyString,
  rowVersion: PositiveInteger,
  rowJson: NonEmptyString,
});

export class ReplicaStateTable extends IndexedDbTable.make({
  name: "replica_state",
  schema: ReplicaStateRow,
  keyPath: "id",
  durability: "strict",
}) {}

export class OutboxTable extends IndexedDbTable.make({
  name: "command_outbox",
  schema: OutboxRow,
  keyPath: "operationId",
  indexes: {
    byStatusSequence: ["status", "clientSequenceLength", "clientSequenceDigits"],
  },
  durability: "strict",
}) {}

export class CoverageTable extends IndexedDbTable.make({
  name: "replica_coverage",
  schema: CoverageRow,
  keyPath: "subscription",
  durability: "strict",
}) {}

export class SnapshotImportTable extends IndexedDbTable.make({
  name: "snapshot_imports",
  schema: SnapshotImportRow,
  keyPath: "snapshotId",
  durability: "strict",
}) {}

export class StockOverlayTable extends IndexedDbTable.make({
  name: "stock_overlays",
  schema: StockOverlayRow,
  keyPath: ["commandId", "batchId"],
  indexes: {
    byBatch: "batchId",
    byCommand: "commandId",
  },
  durability: "strict",
}) {}

export class StagedSnapshotTable extends IndexedDbTable.make({
  name: "snapshot_staged_rows",
  schema: StagedSnapshotRow,
  keyPath: ["snapshotId", "entity", "entityId"],
  indexes: {
    bySnapshot: "snapshotId",
  },
  durability: "strict",
}) {}

export class PendingRowMarkTable extends IndexedDbTable.make({
  name: "pending_row_marks",
  schema: PendingRowMark,
  keyPath: ["entity", "entityId"],
  indexes: {
    byOperation: "operationId",
  },
  durability: "strict",
}) {}

export class PendingRowJournalTable extends IndexedDbTable.make({
  name: "pending_row_journal",
  schema: PendingRowJournalEntry,
  keyPath: ["operationId", "entity", "entityId"],
  indexes: {
    byOperation: "operationId",
  },
  durability: "strict",
}) {}

export class CategoryTable extends IndexedDbTable.make({
  name: "categories",
  schema: withGeneration(ReplicaCategoryRow.fields),
  keyPath: ["generation", "id"],
  indexes: {
    byName: ["generation", "name"],
  },
  durability: "strict",
}) {}

export class ProductTable extends IndexedDbTable.make({
  name: "products",
  schema: withGeneration(ReplicaProductRow.fields),
  keyPath: ["generation", "id"],
  indexes: {
    byCategory: ["generation", "categoryId"],
  },
  durability: "strict",
}) {}

export class BatchTable extends IndexedDbTable.make({
  name: "batches",
  schema: withGeneration(ReplicaBatchRow.fields),
  keyPath: ["generation", "id"],
  indexes: {
    byProduct: ["generation", "productId"],
  },
  durability: "strict",
}) {}

export class InvoiceTable extends IndexedDbTable.make({
  name: "invoices",
  schema: withGeneration(ReplicaInvoiceRow.fields),
  keyPath: ["generation", "id"],
  indexes: {
    byCreatedAt: ["generation", "createdAt"],
    byOperation: ["generation", "operationId"],
  },
  durability: "strict",
}) {}

export class InvoiceItemTable extends IndexedDbTable.make({
  name: "invoice_items",
  schema: withGeneration(ReplicaInvoiceItemRow.fields),
  keyPath: ["generation", "id"],
  indexes: {
    byInvoice: ["generation", "invoiceId"],
  },
  durability: "strict",
}) {}

export class StockMovementTable extends IndexedDbTable.make({
  name: "stock_movements",
  schema: withGeneration(ReplicaStockMovementRow.fields),
  keyPath: ["generation", "id"],
  indexes: {
    byProduct: ["generation", "productId"],
  },
  durability: "strict",
}) {}

export class ReplicaV1 extends IndexedDbVersion.make(
  ReplicaStateTable,
  OutboxTable,
  CoverageTable,
  SnapshotImportTable,
  StockOverlayTable,
  StagedSnapshotTable,
  CategoryTable,
  ProductTable,
  BatchTable,
  InvoiceTable,
  InvoiceItemTable,
  StockMovementTable,
) {}

export class ReplicaV2 extends IndexedDbVersion.make(
  ReplicaStateTable,
  OutboxTable,
  CoverageTable,
  SnapshotImportTable,
  StockOverlayTable,
  StagedSnapshotTable,
  PendingRowMarkTable,
  PendingRowJournalTable,
  CategoryTable,
  ProductTable,
  BatchTable,
  InvoiceTable,
  InvoiceItemTable,
  StockMovementTable,
) {}

export class ReplicaIndexedDbV1 extends IndexedDbDatabase.make(
  ReplicaV1,
  Effect.fn("ReplicaIndexedDb.init")(function* (api) {
    yield* api.createObjectStore("replica_state");
    yield* api.createObjectStore("command_outbox");
    yield* api.createIndex("command_outbox", "byStatusSequence");
    yield* api.createObjectStore("replica_coverage");
    yield* api.createObjectStore("snapshot_imports");
    yield* api.createObjectStore("stock_overlays");
    yield* api.createIndex("stock_overlays", "byBatch");
    yield* api.createIndex("stock_overlays", "byCommand");
    yield* api.createObjectStore("snapshot_staged_rows");
    yield* api.createIndex("snapshot_staged_rows", "bySnapshot");
    yield* api.createObjectStore("categories");
    yield* api.createIndex("categories", "byName");
    yield* api.createObjectStore("products");
    yield* api.createIndex("products", "byCategory");
    yield* api.createObjectStore("batches");
    yield* api.createIndex("batches", "byProduct");
    yield* api.createObjectStore("invoices");
    yield* api.createIndex("invoices", "byCreatedAt");
    yield* api.createIndex("invoices", "byOperation");
    yield* api.createObjectStore("invoice_items");
    yield* api.createIndex("invoice_items", "byInvoice");
    yield* api.createObjectStore("stock_movements");
    yield* api.createIndex("stock_movements", "byProduct");
  }),
) {}

export class ReplicaIndexedDb extends ReplicaIndexedDbV1.add(
  ReplicaV2,
  Effect.fn("ReplicaIndexedDb.addPendingProjections")(function* (_from, api) {
    yield* api.createObjectStore("pending_row_marks");
    yield* api.createIndex("pending_row_marks", "byOperation");
    yield* api.createObjectStore("pending_row_journal");
    yield* api.createIndex("pending_row_journal", "byOperation");
  }),
) {}

export type ReplicaQueryBuilder = IndexedDbQueryBuilder.IndexedDbQueryBuilder<
  (typeof ReplicaIndexedDb)["version"]
>;

const statusBounds = (status: CommandStatus): [[CommandStatus], [CommandStatus, []]] => [
  [status],
  [status, []],
];

export const outboxWithStatus = (api: ReplicaQueryBuilder, status: CommandStatus) => {
  const [lower, upper] = statusBounds(status);
  return api.from("command_outbox").select("byStatusSequence").between(lower, upper);
};

export const countOutboxWithStatus = (api: ReplicaQueryBuilder, status: CommandStatus) => {
  const [lower, upper] = statusBounds(status);
  return api.from("command_outbox").count("byStatusSequence").between(lower, upper);
};
