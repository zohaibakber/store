import {
  AuthorityIncarnation,
  InventoryImportId,
  InventoryObjectName,
  InventoryReleaseId,
  OrganizationId,
  SyncEpoch,
} from "@store/contracts";
import * as Schema from "effect/Schema";

export const POSTGRES_SCHEMA_VERSION = 1;
export const SQLITE_MAPPING_VERSION = 1;

export const MigrationId = Schema.String.check(Schema.isMinLength(1)).pipe(
  Schema.brand("MigrationId"),
);
export type MigrationId = typeof MigrationId.Type;

export const SourceIdentity = Schema.String.check(Schema.isMinLength(1)).pipe(
  Schema.brand("SourceIdentity"),
);
export type SourceIdentity = typeof SourceIdentity.Type;

export const Sha256Hex = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)).pipe(
  Schema.brand("Sha256Hex"),
);
export type Sha256Hex = typeof Sha256Hex.Type;

export const BusinessTable = Schema.Literals([
  "categories",
  "products",
  "batches",
  "invoices",
  "invoice_items",
  "stock_movements",
]);
export type BusinessTable = typeof BusinessTable.Type;

export const BUSINESS_TABLES: ReadonlyArray<BusinessTable> = [
  "categories",
  "products",
  "batches",
  "invoices",
  "invoice_items",
  "stock_movements",
];

export const MigrationStep = Schema.Literals([
  "checkSourceAndDestination",
  "pauseInventoryWrites",
  "exportPostgreSQL",
  "finalizeManifest",
  "importOrganizations",
  "validateRecords",
  "publishDataset",
  "reportCompletion",
]);
export type MigrationStep = typeof MigrationStep.Type;

export const CheckpointName = Schema.Literals([
  "export.afterChunk",
  "import.afterChunk",
  "validate.before",
  "publish.beforeActivate",
  "publish.afterActivate",
]);
export type CheckpointName = typeof CheckpointName.Type;

export const OrganizationSelection = Schema.Struct({
  organizationId: OrganizationId,
  objectName: InventoryObjectName,
});
export interface OrganizationSelection extends Schema.Schema.Type<typeof OrganizationSelection> {}

export const ChunkCursor = Schema.Struct({
  organizationId: OrganizationId,
  table: BusinessTable,
  chunkIndex: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});
export interface ChunkCursor extends Schema.Schema.Type<typeof ChunkCursor> {}

export const SqliteFlag = Schema.Literals([0, 1]);
export type SqliteFlag = typeof SqliteFlag.Type;

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
const EpochMs = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const RowVersion = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
const Money = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const Quantity = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const PositiveQuantity = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
const SignedQuantity = Schema.Number.check(Schema.isInt());

const mutablePostgres = {
  organizationId: OrganizationId,
  createdByUserId: NonEmptyString,
  updatedByUserId: NonEmptyString,
  deviceId: NonEmptyString,
  operationId: NonEmptyString,
  rowVersion: RowVersion,
  createdAt: EpochMs,
  updatedAt: EpochMs,
  deletedAt: Schema.NullOr(EpochMs),
};

export const PostgresCategory = Schema.Struct({
  id: NonEmptyString,
  name: NonEmptyString,
  tracksPacks: Schema.Boolean,
  ...mutablePostgres,
});
export interface PostgresCategory extends Schema.Schema.Type<typeof PostgresCategory> {}

export const PostgresProduct = Schema.Struct({
  id: NonEmptyString,
  name: NonEmptyString,
  categoryId: NonEmptyString,
  aisle: Schema.NullOr(Schema.String),
  composition: Schema.NullOr(Schema.String),
  strength: Schema.NullOr(Schema.String),
  unitsPerPack: PositiveQuantity,
  purchasePrice: Schema.NullOr(Money),
  retailPrice: Schema.NullOr(Money),
  unitPrice: Schema.NullOr(Money),
  visible: Schema.Boolean,
  ...mutablePostgres,
});
export interface PostgresProduct extends Schema.Schema.Type<typeof PostgresProduct> {}

export const PostgresBatch = Schema.Struct({
  id: NonEmptyString,
  productId: NonEmptyString,
  batchNumber: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(EpochMs),
  packQuantity: Quantity,
  unitQuantity: Quantity,
  ...mutablePostgres,
});
export interface PostgresBatch extends Schema.Schema.Type<typeof PostgresBatch> {}

export const PostgresInvoice = Schema.Struct({
  id: NonEmptyString,
  invoiceNumber: PositiveQuantity,
  customerName: Schema.NullOr(Schema.String),
  total: Money,
  ...mutablePostgres,
});
export interface PostgresInvoice extends Schema.Schema.Type<typeof PostgresInvoice> {}

export const PostgresInvoiceItem = Schema.Struct({
  id: NonEmptyString,
  invoiceId: NonEmptyString,
  productId: NonEmptyString,
  batchId: NonEmptyString,
  productName: NonEmptyString,
  batchNumber: Schema.NullOr(Schema.String),
  quantity: PositiveQuantity,
  quantityType: Schema.Literals(["unit", "pack"]),
  baseUnitQuantity: PositiveQuantity,
  salePrice: Money,
  ...mutablePostgres,
});
export interface PostgresInvoiceItem extends Schema.Schema.Type<typeof PostgresInvoiceItem> {}

export const PostgresStockMovement = Schema.Struct({
  id: NonEmptyString,
  productId: NonEmptyString,
  batchId: NonEmptyString,
  invoiceId: Schema.NullOr(NonEmptyString),
  type: Schema.Literals(["stock_in", "sale", "open_pack", "adjustment"]),
  packDelta: SignedQuantity,
  unitDelta: SignedQuantity,
  note: Schema.NullOr(Schema.String),
  organizationId: OrganizationId,
  actorUserId: NonEmptyString,
  deviceId: NonEmptyString,
  operationId: NonEmptyString,
  createdAt: EpochMs,
});
export interface PostgresStockMovement extends Schema.Schema.Type<typeof PostgresStockMovement> {}

const mutableSqlite = {
  organizationId: OrganizationId,
  createdByUserId: NonEmptyString,
  updatedByUserId: NonEmptyString,
  deviceId: NonEmptyString,
  operationId: NonEmptyString,
  rowVersion: RowVersion,
  createdAt: EpochMs,
  updatedAt: EpochMs,
  deletedAt: Schema.NullOr(EpochMs),
};

export const SqliteCategory = Schema.Struct({
  id: NonEmptyString,
  name: NonEmptyString,
  tracksPacks: SqliteFlag,
  ...mutableSqlite,
});
export interface SqliteCategory extends Schema.Schema.Type<typeof SqliteCategory> {}

export const SqliteProduct = Schema.Struct({
  id: NonEmptyString,
  name: NonEmptyString,
  categoryId: NonEmptyString,
  aisle: Schema.NullOr(Schema.String),
  composition: Schema.NullOr(Schema.String),
  strength: Schema.NullOr(Schema.String),
  unitsPerPack: PositiveQuantity,
  purchasePrice: Schema.NullOr(Money),
  retailPrice: Schema.NullOr(Money),
  unitPrice: Schema.NullOr(Money),
  visible: SqliteFlag,
  ...mutableSqlite,
});
export interface SqliteProduct extends Schema.Schema.Type<typeof SqliteProduct> {}

export const SqliteBatch = Schema.Struct({
  id: NonEmptyString,
  productId: NonEmptyString,
  batchNumber: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(EpochMs),
  packQuantity: Quantity,
  unitQuantity: Quantity,
  ...mutableSqlite,
});
export interface SqliteBatch extends Schema.Schema.Type<typeof SqliteBatch> {}

export const SqliteInvoice = Schema.Struct({
  id: NonEmptyString,
  invoiceNumber: PositiveQuantity,
  customerName: Schema.NullOr(Schema.String),
  total: Money,
  ...mutableSqlite,
});
export interface SqliteInvoice extends Schema.Schema.Type<typeof SqliteInvoice> {}

export const SqliteInvoiceItem = Schema.Struct({
  id: NonEmptyString,
  invoiceId: NonEmptyString,
  productId: NonEmptyString,
  batchId: NonEmptyString,
  productName: NonEmptyString,
  batchNumber: Schema.NullOr(Schema.String),
  quantity: PositiveQuantity,
  quantityType: Schema.Literals(["unit", "pack"]),
  baseUnitQuantity: PositiveQuantity,
  salePrice: Money,
  ...mutableSqlite,
});
export interface SqliteInvoiceItem extends Schema.Schema.Type<typeof SqliteInvoiceItem> {}

export const SqliteStockMovement = Schema.Struct({
  id: NonEmptyString,
  productId: NonEmptyString,
  batchId: NonEmptyString,
  invoiceId: Schema.NullOr(NonEmptyString),
  type: Schema.Literals(["stock_in", "sale", "open_pack", "adjustment"]),
  packDelta: SignedQuantity,
  unitDelta: SignedQuantity,
  note: Schema.NullOr(Schema.String),
  organizationId: OrganizationId,
  actorUserId: NonEmptyString,
  deviceId: NonEmptyString,
  operationId: NonEmptyString,
  createdAt: EpochMs,
});
export interface SqliteStockMovement extends Schema.Schema.Type<typeof SqliteStockMovement> {}

export const SqliteBusinessRow = Schema.Union([
  SqliteCategory,
  SqliteProduct,
  SqliteBatch,
  SqliteInvoice,
  SqliteInvoiceItem,
  SqliteStockMovement,
]);
export type SqliteBusinessRow = typeof SqliteBusinessRow.Type;

export const TableChecksum = Schema.Struct({
  table: BusinessTable,
  rowCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  checksum: Sha256Hex,
});
export interface TableChecksum extends Schema.Schema.Type<typeof TableChecksum> {}

export const OrganizationAggregates = Schema.Struct({
  invoiceTotalSum: Money,
  batchPackQuantitySum: Quantity,
  batchUnitQuantitySum: Quantity,
  movementPackDeltaSum: SignedQuantity,
  movementUnitDeltaSum: SignedQuantity,
});
export interface OrganizationAggregates extends Schema.Schema.Type<typeof OrganizationAggregates> {}

export const OrganizationManifest = Schema.Struct({
  organizationId: OrganizationId,
  objectName: InventoryObjectName,
  tables: Schema.Array(TableChecksum),
  aggregates: OrganizationAggregates,
});
export interface OrganizationManifest extends Schema.Schema.Type<typeof OrganizationManifest> {}

export const ExportManifest = Schema.Struct({
  schemaVersion: Schema.Literal(POSTGRES_SCHEMA_VERSION),
  mappingVersion: Schema.Literal(SQLITE_MAPPING_VERSION),
  organizations: Schema.NonEmptyArray(OrganizationManifest),
  checksum: Sha256Hex,
});
export interface ExportManifest extends Schema.Schema.Type<typeof ExportManifest> {}

export const ExportChunk = Schema.Struct({
  organizationId: OrganizationId,
  table: BusinessTable,
  chunkIndex: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  checksum: Sha256Hex,
  rowsJson: Schema.String,
});
export interface ExportChunk extends Schema.Schema.Type<typeof ExportChunk> {}

export const ApplyChunkOutcome = Schema.TaggedUnion({
  applied: {},
  duplicate: {},
});
export type ApplyChunkOutcome = typeof ApplyChunkOutcome.Type;

export const ImportObjectState = Schema.TaggedUnion({
  empty: { organizationId: OrganizationId },
  importing: {
    organizationId: OrganizationId,
    importId: InventoryImportId,
    epoch: SyncEpoch,
    incarnation: AuthorityIncarnation,
  },
  ready: {
    organizationId: OrganizationId,
    importId: InventoryImportId,
    epoch: SyncEpoch,
    incarnation: AuthorityIncarnation,
  },
});
export type ImportObjectState = typeof ImportObjectState.Type;

export const ActiveReleasePointer = Schema.Struct({
  releaseId: InventoryReleaseId,
  activatedAtSeconds: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});
export interface ActiveReleasePointer extends Schema.Schema.Type<typeof ActiveReleasePointer> {}

export const MigrationPhase = Schema.TaggedUnion({
  Checking: {},
  Frozen: {},
  Exporting: {
    lastCompletedChunk: Schema.NullOr(ChunkCursor),
  },
  ManifestReady: {
    manifestChecksum: Sha256Hex,
  },
  Importing: {
    manifestChecksum: Sha256Hex,
    lastCompletedChunk: Schema.NullOr(ChunkCursor),
  },
  Validated: {
    manifestChecksum: Sha256Hex,
    releaseId: InventoryReleaseId,
  },
  Completed: {
    manifestChecksum: Sha256Hex,
    releaseId: InventoryReleaseId,
    publishedAt: Schema.Number,
  },
});
export type MigrationPhase = typeof MigrationPhase.Type;

export const MigrationRecord = Schema.Struct({
  migrationId: MigrationId,
  sourceIdentity: SourceIdentity,
  schemaVersion: Schema.Literal(POSTGRES_SCHEMA_VERSION),
  mappingVersion: Schema.Literal(SQLITE_MAPPING_VERSION),
  organizations: Schema.NonEmptyArray(OrganizationSelection),
  importId: InventoryImportId,
  phase: MigrationPhase,
});
export interface MigrationRecord extends Schema.Schema.Type<typeof MigrationRecord> {}

export const CompletedMigration = Schema.Struct({
  migrationId: MigrationId,
  importId: InventoryImportId,
  releaseId: InventoryReleaseId,
  publishedAt: Schema.Number,
  organizationCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  manifestChecksum: Sha256Hex,
});
export interface CompletedMigration extends Schema.Schema.Type<typeof CompletedMigration> {}

export const MigrationRequest = Schema.Struct({
  sourceIdentity: SourceIdentity,
  organizations: Schema.NonEmptyArray(OrganizationSelection),
  chunkSize: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
});
export interface MigrationRequest extends Schema.Schema.Type<typeof MigrationRequest> {}

export const DEFAULT_CHUNK_SIZE = 500;
export const INITIAL_SYNC_EPOCH = SyncEpoch.make("1");

export const DriverScalar = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
]);
export type DriverScalar = typeof DriverScalar.Type;
export const DriverRow = Schema.Record(Schema.String, DriverScalar);
export type DriverRow = typeof DriverRow.Type;
