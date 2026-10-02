import * as IndexedDbDatabase from "@effect/platform-browser/IndexedDbDatabase";
import type * as IndexedDbQueryBuilder from "@effect/platform-browser/IndexedDbQueryBuilder";
import * as IndexedDbTable from "@effect/platform-browser/IndexedDbTable";
import * as IndexedDbVersion from "@effect/platform-browser/IndexedDbVersion";
import { PositiveInt, SyncEntity, type SyncEntityChange } from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import {
  CommandStatus,
  replicaEntitySchemas,
  ReplicaBatchRow,
  ReplicaCategoryRow,
  ReplicaInvoiceItemRow,
  ReplicaInvoiceRow,
  ReplicaProductRow,
  ReplicaPurchaseOrderItemRow,
  ReplicaPurchaseOrderRow,
  ReplicaStockMovementRow,
  ReplicaSupplierRow,
} from "@store/contracts/sync/replica-model";
import { getTableName } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
const NonNegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const SignedInteger = Schema.Number.check(Schema.isInt());

const withGeneration = <A extends Schema.Struct.Fields>(fields: A) =>
  Schema.Struct({
    generation: PositiveInt,
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
  activeGeneration: PositiveInt,
  caughtUpAt: Schema.NullOr(NonNegativeInteger),
  registeredAt: Schema.NullOr(NonNegativeInteger),
  announcedSchemaVersion: Schema.optionalKey(Schema.NullOr(PositiveInt)),
  lowestActiveSchemaVersion: Schema.optionalKey(Schema.NullOr(PositiveInt)),
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

const CoverageRow = Schema.Struct({
  subscription: NonEmptyString,
  state: Schema.Literals(["awaiting_snapshot", "downloaded"]),
  throughCommitSequence: Schema.NullOr(NonEmptyString),
  digest: Schema.NullOr(NonEmptyString),
  verifiedAt: Schema.NullOr(NonNegativeInteger),
});

const SnapshotImportRow = Schema.Struct({
  snapshotId: NonEmptyString,
  generation: PositiveInt,
  subscription: NonEmptyString,
  horizon: NonEmptyString,
  stage: Schema.Literals(["importing", "caught_up", "activated", "failed"]),
  partsImported: NonNegativeInteger,
  partsTotal: NonNegativeInteger,
});

const StockOverlayRow = Schema.Struct({
  commandId: NonEmptyString,
  batchId: NonEmptyString,
  packDelta: SignedInteger,
  unitDelta: SignedInteger,
});

const PendingRowMark = Schema.Struct({
  entity: NonEmptyString,
  entityId: NonEmptyString,
  operationId: NonEmptyString,
});

const PendingRowJournalEntry = Schema.Struct({
  operationId: NonEmptyString,
  entity: NonEmptyString,
  entityId: NonEmptyString,
  priorRowJson: Schema.NullOr(NonEmptyString),
});

const StagedSnapshotRow = Schema.Struct({
  snapshotId: NonEmptyString,
  entity: NonEmptyString,
  entityId: NonEmptyString,
  rowVersion: PositiveInt,
  rowJson: NonEmptyString,
});

class ReplicaStateTable extends IndexedDbTable.make({
  name: "replica_state",
  schema: ReplicaStateRow,
  keyPath: "id",
  durability: "strict",
}) {}

class OutboxTable extends IndexedDbTable.make({
  name: "command_outbox",
  schema: OutboxRow,
  keyPath: "operationId",
  indexes: {
    byStatusSequence: ["status", "clientSequenceLength", "clientSequenceDigits"],
  },
  durability: "strict",
}) {}

class CoverageTable extends IndexedDbTable.make({
  name: "replica_coverage",
  schema: CoverageRow,
  keyPath: "subscription",
  durability: "strict",
}) {}

class SnapshotImportTable extends IndexedDbTable.make({
  name: "snapshot_imports",
  schema: SnapshotImportRow,
  keyPath: "snapshotId",
  durability: "strict",
}) {}

class StockOverlayTable extends IndexedDbTable.make({
  name: "stock_overlays",
  schema: StockOverlayRow,
  keyPath: ["commandId", "batchId"],
  indexes: {
    byBatch: "batchId",
    byCommand: "commandId",
  },
  durability: "strict",
}) {}

class StagedSnapshotTable extends IndexedDbTable.make({
  name: "snapshot_staged_rows",
  schema: StagedSnapshotRow,
  keyPath: ["snapshotId", "entity", "entityId"],
  indexes: {
    bySnapshot: "snapshotId",
  },
  durability: "strict",
}) {}

class PendingRowMarkTable extends IndexedDbTable.make({
  name: "pending_row_marks",
  schema: PendingRowMark,
  keyPath: ["entity", "entityId"],
  indexes: {
    byOperation: "operationId",
  },
  durability: "strict",
}) {}

class PendingRowJournalTable extends IndexedDbTable.make({
  name: "pending_row_journal",
  schema: PendingRowJournalEntry,
  keyPath: ["operationId", "entity", "entityId"],
  indexes: {
    byOperation: "operationId",
  },
  durability: "strict",
}) {}

class CategoryTable extends IndexedDbTable.make({
  name: "categories",
  schema: withGeneration(ReplicaCategoryRow.fields),
  keyPath: ["generation", "id"],
  indexes: {
    byName: ["generation", "name"],
  },
  durability: "strict",
}) {}

export const foldAsciiCase = (value: string): string =>
  value.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());

const StoredProductRow = withGeneration({ ...ReplicaProductRow.fields, nameKey: Schema.String });
type StoredProductRow = typeof StoredProductRow.Type;

export const storedProduct = (generation: number, row: typeof ReplicaProductRow.Type) =>
  ({ generation, ...row, nameKey: foldAsciiCase(row.name) }) satisfies StoredProductRow;

class ProductTable extends IndexedDbTable.make({
  name: "products",
  schema: StoredProductRow,
  keyPath: ["generation", "id"],
  indexes: {
    byCategory: ["generation", "categoryId"],
    byNameKey: ["generation", "nameKey"],
    byCategoryName: ["generation", "categoryId", "nameKey"],
  },
  durability: "strict",
}) {}

class BatchTable extends IndexedDbTable.make({
  name: "batches",
  schema: withGeneration(ReplicaBatchRow.fields),
  keyPath: ["generation", "id"],
  indexes: {
    byProduct: ["generation", "productId"],
  },
  durability: "strict",
}) {}

class InvoiceTable extends IndexedDbTable.make({
  name: "invoices",
  schema: withGeneration(ReplicaInvoiceRow.fields),
  keyPath: ["generation", "id"],
  indexes: {
    byCreatedAt: ["generation", "createdAt"],
    byOperation: ["generation", "operationId"],
  },
  durability: "strict",
}) {}

class InvoiceTableV2 extends IndexedDbTable.make({
  name: "invoices",
  schema: withGeneration(ReplicaInvoiceRow.fields),
  keyPath: ["generation", "id"],
  indexes: {
    byCreatedAt: ["generation", "createdAt"],
    byOperation: ["generation", "operationId"],
    byInvoiceNumber: ["generation", "invoiceNumber"],
  },
  durability: "strict",
}) {}

class PendingRowJournalTableV2 extends IndexedDbTable.make({
  name: "pending_row_journal",
  schema: PendingRowJournalEntry,
  keyPath: ["operationId", "entity", "entityId"],
  indexes: {
    byOperation: "operationId",
    byEntity: ["entity", "entityId"],
  },
  durability: "strict",
}) {}

class InvoiceItemTable extends IndexedDbTable.make({
  name: "invoice_items",
  schema: withGeneration(ReplicaInvoiceItemRow.fields),
  keyPath: ["generation", "id"],
  indexes: {
    byInvoice: ["generation", "invoiceId"],
  },
  durability: "strict",
}) {}

class StockMovementTable extends IndexedDbTable.make({
  name: "stock_movements",
  schema: withGeneration(ReplicaStockMovementRow.fields),
  keyPath: ["generation", "id"],
  indexes: {
    byProduct: ["generation", "productId"],
  },
  durability: "strict",
}) {}

class SupplierTable extends IndexedDbTable.make({
  name: "suppliers",
  schema: withGeneration(ReplicaSupplierRow.fields),
  keyPath: ["generation", "id"],
  indexes: {
    byName: ["generation", "name"],
  },
  durability: "strict",
}) {}

class PurchaseOrderTable extends IndexedDbTable.make({
  name: "purchase_orders",
  schema: withGeneration(ReplicaPurchaseOrderRow.fields),
  keyPath: ["generation", "id"],
  indexes: {
    byOrderNumber: ["generation", "orderNumber"],
    bySupplier: ["generation", "supplierId"],
    byStatusCreatedAt: ["generation", "status", "createdAt"],
  },
  durability: "strict",
}) {}

class PurchaseOrderItemTable extends IndexedDbTable.make({
  name: "purchase_order_items",
  schema: withGeneration(ReplicaPurchaseOrderItemRow.fields),
  keyPath: ["generation", "id"],
  indexes: {
    byPurchaseOrder: ["generation", "purchaseOrderId"],
    byProduct: ["generation", "productId"],
  },
  durability: "strict",
}) {}

class ReplicaV1 extends IndexedDbVersion.make(
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

class ReplicaV2 extends IndexedDbVersion.make(
  ReplicaStateTable,
  OutboxTable,
  CoverageTable,
  SnapshotImportTable,
  StockOverlayTable,
  StagedSnapshotTable,
  PendingRowMarkTable,
  PendingRowJournalTableV2,
  CategoryTable,
  ProductTable,
  BatchTable,
  InvoiceTableV2,
  InvoiceItemTable,
  StockMovementTable,
) {}

class ReplicaV3 extends IndexedDbVersion.make(
  ReplicaStateTable,
  OutboxTable,
  CoverageTable,
  SnapshotImportTable,
  StockOverlayTable,
  StagedSnapshotTable,
  PendingRowMarkTable,
  PendingRowJournalTableV2,
  CategoryTable,
  ProductTable,
  BatchTable,
  InvoiceTableV2,
  InvoiceItemTable,
  StockMovementTable,
  SupplierTable,
  PurchaseOrderTable,
  PurchaseOrderItemTable,
) {}

export class ReplicaIndexedDb extends IndexedDbDatabase.make(
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
    yield* api.createObjectStore("pending_row_marks");
    yield* api.createIndex("pending_row_marks", "byOperation");
    yield* api.createObjectStore("pending_row_journal");
    yield* api.createIndex("pending_row_journal", "byOperation");
    yield* api.createObjectStore("categories");
    yield* api.createIndex("categories", "byName");
    yield* api.createObjectStore("products");
    yield* api.createIndex("products", "byCategory");
    yield* api.createIndex("products", "byNameKey");
    yield* api.createIndex("products", "byCategoryName");
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
)
  .add(
    ReplicaV2,
    Effect.fn("ReplicaIndexedDb.addLookupIndexes")(function* (_from, api) {
      yield* api.createIndex("invoices", "byInvoiceNumber");
      yield* api.createIndex("pending_row_journal", "byEntity");
    }),
  )
  .add(
    ReplicaV3,
    Effect.fn("ReplicaIndexedDb.addPurchasing")(function* (_from, api) {
      yield* api.createObjectStore("suppliers");
      yield* api.createIndex("suppliers", "byName");
      yield* api.createObjectStore("purchase_orders");
      yield* api.createIndex("purchase_orders", "byOrderNumber");
      yield* api.createIndex("purchase_orders", "bySupplier");
      yield* api.createIndex("purchase_orders", "byStatusCreatedAt");
      yield* api.createObjectStore("purchase_order_items");
      yield* api.createIndex("purchase_order_items", "byPurchaseOrder");
      yield* api.createIndex("purchase_order_items", "byProduct");
      const imports = yield* api.from("snapshot_imports").select();
      yield* Effect.forEach(
        imports.filter((row) => row.stage === "importing" || row.stage === "caught_up"),
        (row) => api.from("snapshot_imports").upsert({ ...row, stage: "failed" }),
        { discard: true },
      );
      const coverage = yield* api.from("replica_coverage").select();
      yield* Effect.forEach(
        coverage,
        (row) => api.from("replica_coverage").upsert({ ...row, verifiedAt: null }),
        { discard: true },
      );
    }),
  ) {}

export type IndexedDbTableName = Parameters<ReplicaQueryBuilder["from"]>[0];

export type EntityStore<Entity extends SyncEntity> =
  (typeof syncEntityRows)[Entity]["table"]["_"]["name"];

export const entityStore = <Entity extends SyncEntity>(entity: Entity): EntityStore<Entity> =>
  getTableName(syncEntityRows[entity].table);

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

export const ENTITY_STORES = SyncEntity.literals.map(entityStore);

export const storedEntityRow = (
  generation: number,
  entity: SyncEntity,
  row: SyncEntityChange["row"],
) =>
  entity === "product"
    ? storedProduct(generation, Schema.decodeUnknownSync(replicaEntitySchemas.product)(row))
    : { generation, ...Schema.decodeUnknownSync(replicaEntitySchemas[entity])(row) };
