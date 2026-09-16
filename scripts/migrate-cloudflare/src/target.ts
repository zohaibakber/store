import {
  type AuthorityIncarnation,
  type InventoryImportId,
  type OrganizationId,
  padDecimalSequence,
} from "@store/contracts";
import {
  batches,
  categories,
  commandReceipts,
  inventoryState,
  invoiceItems,
  invoices,
  products,
  replicas,
  stockMovements,
} from "@store/db/inventory.schema";
import type Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { casesHandled } from "./cases.ts";
import {
  ChunkContentMismatch,
  ImportRejected,
  PersistenceError,
  TranslationFailed,
} from "./errors.ts";
import { decodeChunkRows, rowsChecksum, sqliteFlag } from "./mapping.ts";
import {
  type ApplyChunkOutcome,
  ApplyChunkOutcome as ApplyChunkOutcomeSchema,
  type BusinessTable,
  type ImportObjectState,
  ImportObjectState as ImportObjectStateSchema,
  INITIAL_SYNC_EPOCH,
  type Sha256Hex,
  type SqliteBusinessRow,
  SqliteBatch as SqliteBatchSchema,
  SqliteCategory as SqliteCategorySchema,
  SqliteInvoice as SqliteInvoiceSchema,
  SqliteInvoiceItem as SqliteInvoiceItemSchema,
  SqliteProduct as SqliteProductSchema,
  SqliteStockMovement as SqliteStockMovementSchema,
} from "./model.ts";
import { migrateInventoryAuthority, runSqliteTransaction } from "./sqlite.ts";

export interface OrganizationInventoryImportApi {
  readonly prepareImport: (
    organizationId: OrganizationId,
    importId: InventoryImportId,
    incarnation: AuthorityIncarnation,
  ) => Effect.Effect<void, ImportRejected | PersistenceError>;
  readonly applyChunk: (
    organizationId: OrganizationId,
    importId: InventoryImportId,
    table: BusinessTable,
    chunkIndex: number,
    checksum: Sha256Hex,
    rowsJson: string,
  ) => Effect.Effect<
    ApplyChunkOutcome,
    ChunkContentMismatch | ImportRejected | PersistenceError | TranslationFailed
  >;
  readonly readTable: (
    organizationId: OrganizationId,
    table: BusinessTable,
  ) => Effect.Effect<ReadonlyArray<SqliteBusinessRow>, PersistenceError | TranslationFailed>;
  readonly countReplicas: (
    organizationId: OrganizationId,
  ) => Effect.Effect<number, PersistenceError>;
  readonly countReceipts: (
    organizationId: OrganizationId,
  ) => Effect.Effect<number, PersistenceError>;
  readonly markReady: (
    organizationId: OrganizationId,
    importId: InventoryImportId,
  ) => Effect.Effect<void, ImportRejected | PersistenceError>;
  readonly readImportState: (
    organizationId: OrganizationId,
  ) => Effect.Effect<ImportObjectState, PersistenceError>;
}

export class OrganizationInventoryImport extends Context.Service<
  OrganizationInventoryImport,
  OrganizationInventoryImportApi
>()("@store/migrate/OrganizationInventoryImport") {}

const persistenceFail = (operation: string, cause: unknown): PersistenceError =>
  new PersistenceError({
    operation,
    message: `Inventory import ${operation} failed.`,
    cause,
  });

const AppliedChunkRow = Schema.Struct({ checksum: Schema.String });

type InventoryDb = ReturnType<typeof drizzle>;

const insertRows = (
  db: InventoryDb,
  table: BusinessTable,
  rows: ReadonlyArray<SqliteBusinessRow>,
): void => {
  switch (table) {
    case "categories":
      for (const row of rows.filter(Schema.is(SqliteCategorySchema))) {
        db.insert(categories)
          .values({
            id: row.id,
            name: row.name,
            tracksPacks: row.tracksPacks === 1,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
            organizationId: row.organizationId,
            createdByUserId: row.createdByUserId,
            updatedByUserId: row.updatedByUserId,
            deviceId: row.deviceId,
            operationId: row.operationId,
            rowVersion: row.rowVersion,
          })
          .run();
      }
      return;
    case "products":
      for (const row of rows.filter(Schema.is(SqliteProductSchema))) {
        db.insert(products)
          .values({
            id: row.id,
            name: row.name,
            categoryId: row.categoryId,
            aisle: row.aisle,
            composition: row.composition,
            strength: row.strength,
            unitsPerPack: row.unitsPerPack,
            purchasePrice: row.purchasePrice,
            retailPrice: row.retailPrice,
            unitPrice: row.unitPrice,
            visible: row.visible === 1,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
            organizationId: row.organizationId,
            createdByUserId: row.createdByUserId,
            updatedByUserId: row.updatedByUserId,
            deviceId: row.deviceId,
            operationId: row.operationId,
            rowVersion: row.rowVersion,
          })
          .run();
      }
      return;
    case "batches":
      for (const row of rows.filter(Schema.is(SqliteBatchSchema))) {
        db.insert(batches)
          .values({
            id: row.id,
            productId: row.productId,
            batchNumber: row.batchNumber,
            expiresAt: row.expiresAt,
            packQuantity: row.packQuantity,
            unitQuantity: row.unitQuantity,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
            organizationId: row.organizationId,
            createdByUserId: row.createdByUserId,
            updatedByUserId: row.updatedByUserId,
            deviceId: row.deviceId,
            operationId: row.operationId,
            rowVersion: row.rowVersion,
          })
          .run();
      }
      return;
    case "invoices":
      for (const row of rows.filter(Schema.is(SqliteInvoiceSchema))) {
        db.insert(invoices)
          .values({
            id: row.id,
            invoiceNumber: row.invoiceNumber,
            customerName: row.customerName,
            total: row.total,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
            organizationId: row.organizationId,
            createdByUserId: row.createdByUserId,
            updatedByUserId: row.updatedByUserId,
            deviceId: row.deviceId,
            operationId: row.operationId,
            rowVersion: row.rowVersion,
          })
          .run();
      }
      return;
    case "invoice_items":
      for (const row of rows.filter(Schema.is(SqliteInvoiceItemSchema))) {
        db.insert(invoiceItems)
          .values({
            id: row.id,
            invoiceId: row.invoiceId,
            productId: row.productId,
            batchId: row.batchId,
            productName: row.productName,
            batchNumber: row.batchNumber,
            quantity: row.quantity,
            quantityType: row.quantityType,
            baseUnitQuantity: row.baseUnitQuantity,
            salePrice: row.salePrice,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
            organizationId: row.organizationId,
            createdByUserId: row.createdByUserId,
            updatedByUserId: row.updatedByUserId,
            deviceId: row.deviceId,
            operationId: row.operationId,
            rowVersion: row.rowVersion,
          })
          .run();
      }
      return;
    case "stock_movements":
      for (const row of rows.filter(Schema.is(SqliteStockMovementSchema))) {
        db.insert(stockMovements)
          .values({
            id: row.id,
            productId: row.productId,
            batchId: row.batchId,
            invoiceId: row.invoiceId,
            type: row.type,
            packDelta: row.packDelta,
            unitDelta: row.unitDelta,
            note: row.note,
            organizationId: row.organizationId,
            actorUserId: row.actorUserId,
            deviceId: row.deviceId,
            operationId: row.operationId,
            createdAt: row.createdAt,
          })
          .run();
      }
      return;
    default:
      casesHandled(table);
  }
};

const failTranslate = (table: BusinessTable, cause: unknown): TranslationFailed =>
  new TranslationFailed({
    table,
    message: `Stored ${table} row failed SQLite schema checks.`,
    cause,
  });

const readRows = (
  db: InventoryDb,
  organizationId: OrganizationId,
  table: BusinessTable,
): Effect.Effect<ReadonlyArray<SqliteBusinessRow>, PersistenceError | TranslationFailed> =>
  Effect.gen(function* () {
    switch (table) {
      case "categories": {
        const stored = yield* Effect.try({
          try: () =>
            db.select().from(categories).where(eq(categories.organizationId, organizationId)).all(),
          catch: (cause) => persistenceFail("readTable", cause),
        });
        return yield* Effect.forEach(stored, (row) =>
          Schema.decodeUnknownEffect(SqliteCategorySchema)({
            ...row,
            tracksPacks: sqliteFlag(row.tracksPacks),
          }).pipe(Effect.mapError((cause) => failTranslate(table, cause))),
        );
      }
      case "products": {
        const stored = yield* Effect.try({
          try: () =>
            db.select().from(products).where(eq(products.organizationId, organizationId)).all(),
          catch: (cause) => persistenceFail("readTable", cause),
        });
        return yield* Effect.forEach(stored, (row) =>
          Schema.decodeUnknownEffect(SqliteProductSchema)({
            ...row,
            visible: sqliteFlag(row.visible),
          }).pipe(Effect.mapError((cause) => failTranslate(table, cause))),
        );
      }
      case "batches": {
        const stored = yield* Effect.try({
          try: () =>
            db.select().from(batches).where(eq(batches.organizationId, organizationId)).all(),
          catch: (cause) => persistenceFail("readTable", cause),
        });
        return yield* Effect.forEach(stored, (row) =>
          Schema.decodeUnknownEffect(SqliteBatchSchema)(row).pipe(
            Effect.mapError((cause) => failTranslate(table, cause)),
          ),
        );
      }
      case "invoices": {
        const stored = yield* Effect.try({
          try: () =>
            db.select().from(invoices).where(eq(invoices.organizationId, organizationId)).all(),
          catch: (cause) => persistenceFail("readTable", cause),
        });
        return yield* Effect.forEach(stored, (row) =>
          Schema.decodeUnknownEffect(SqliteInvoiceSchema)(row).pipe(
            Effect.mapError((cause) => failTranslate(table, cause)),
          ),
        );
      }
      case "invoice_items": {
        const stored = yield* Effect.try({
          try: () =>
            db
              .select()
              .from(invoiceItems)
              .where(eq(invoiceItems.organizationId, organizationId))
              .all(),
          catch: (cause) => persistenceFail("readTable", cause),
        });
        return yield* Effect.forEach(stored, (row) =>
          Schema.decodeUnknownEffect(SqliteInvoiceItemSchema)(row).pipe(
            Effect.mapError((cause) => failTranslate(table, cause)),
          ),
        );
      }
      case "stock_movements": {
        const stored = yield* Effect.try({
          try: () =>
            db
              .select()
              .from(stockMovements)
              .where(eq(stockMovements.organizationId, organizationId))
              .all(),
          catch: (cause) => persistenceFail("readTable", cause),
        });
        return yield* Effect.forEach(stored, (row) =>
          Schema.decodeUnknownEffect(SqliteStockMovementSchema)(row).pipe(
            Effect.mapError((cause) => failTranslate(table, cause)),
          ),
        );
      }
      default:
        return casesHandled(table);
    }
  });

const makeTarget = (sqlite: Database.Database): OrganizationInventoryImportApi => {
  const db = drizzle({ client: sqlite });
  const selectApplied = sqlite.prepare(
    "select checksum from import_applied_chunks where organization_id = ? and table_name = ? and chunk_index = ?",
  );
  const insertApplied = sqlite.prepare(
    "insert into import_applied_chunks (organization_id, table_name, chunk_index, checksum) values (?, ?, ?, ?)",
  );
  const requireImporting = (
    organizationId: OrganizationId,
    importId: InventoryImportId,
    operation: string,
  ): void => {
    const state = db
      .select()
      .from(inventoryState)
      .where(eq(inventoryState.organizationId, organizationId))
      .get();
    if (state === undefined) {
      throw new ImportRejected({
        organizationId,
        message: `Inventory object is empty during ${operation}.`,
      });
    }
    if (state.status !== "importing" || state.importId !== importId) {
      throw new ImportRejected({
        organizationId,
        message: `Inventory object is not an importing target for ${importId}.`,
      });
    }
  };

  return {
    prepareImport: Effect.fn("Migrate.Target.prepareImport")(function* (
      organizationId: OrganizationId,
      importId: InventoryImportId,
      incarnation: AuthorityIncarnation,
    ) {
      yield* Effect.try({
        try: () =>
          runSqliteTransaction(sqlite, () => {
            const state = db
              .select()
              .from(inventoryState)
              .where(eq(inventoryState.organizationId, organizationId))
              .get();
            if (state === undefined) {
              db.insert(inventoryState)
                .values({
                  organizationId,
                  status: "importing",
                  importId,
                  releaseId: null,
                  incarnation,
                  epoch: INITIAL_SYNC_EPOCH,
                  commitSequence: padDecimalSequence("0"),
                  retentionFloor: padDecimalSequence("0"),
                })
                .run();
              return;
            }
            if (state.status === "ready") {
              if (state.importId === importId) return;
              throw new ImportRejected({
                organizationId,
                message: "Import attempts against an already active target are rejected.",
              });
            }
            if (state.importId !== importId) {
              throw new ImportRejected({
                organizationId,
                message: "Inventory object is already importing a different dataset.",
              });
            }
          }),
        catch: (cause) => {
          if (cause instanceof ImportRejected) return cause;
          return persistenceFail("prepareImport", cause);
        },
      });
    }),
    applyChunk: Effect.fn("Migrate.Target.applyChunk")(function* (
      organizationId: OrganizationId,
      importId: InventoryImportId,
      table: BusinessTable,
      chunkIndex: number,
      checksum: Sha256Hex,
      rowsJson: string,
    ) {
      const rows = yield* decodeChunkRows(table, rowsJson);
      const actualChecksum = rowsChecksum(rows);
      if (actualChecksum !== checksum) {
        return yield* Effect.fail(
          new ChunkContentMismatch({
            organizationId,
            table,
            chunkIndex,
            message: "Imported chunk identity collided with different bytes.",
          }),
        );
      }
      const owned = rows.every((row) => row.organizationId === organizationId);
      if (!owned) {
        return yield* Effect.fail(
          new ImportRejected({
            organizationId,
            message: `Chunk ${table} ${String(chunkIndex)} contains a foreign organization.`,
          }),
        );
      }
      return yield* Effect.try({
        try: () =>
          runSqliteTransaction(sqlite, () => {
            const existing = Schema.decodeUnknownOption(AppliedChunkRow)(
              selectApplied.get(organizationId, table, chunkIndex),
            );
            if (Option.isSome(existing)) {
              if (existing.value.checksum !== checksum) {
                throw new ChunkContentMismatch({
                  organizationId,
                  table,
                  chunkIndex,
                  message: "Imported chunk identity collided with different bytes.",
                });
              }
              return ApplyChunkOutcomeSchema.cases.duplicate.make({});
            }
            requireImporting(organizationId, importId, "applyChunk");
            insertRows(db, table, rows);
            insertApplied.run(organizationId, table, chunkIndex, checksum);
            return ApplyChunkOutcomeSchema.cases.applied.make({});
          }),
        catch: (cause) => {
          if (cause instanceof ChunkContentMismatch || cause instanceof ImportRejected)
            return cause;
          return persistenceFail("applyChunk", cause);
        },
      });
    }),
    readTable: Effect.fn("Migrate.Target.readTable")(function* (
      organizationId: OrganizationId,
      table: BusinessTable,
    ) {
      return yield* readRows(db, organizationId, table);
    }),
    countReplicas: Effect.fn("Migrate.Target.countReplicas")(function* (
      organizationId: OrganizationId,
    ) {
      const rows = yield* Effect.try({
        try: () =>
          db.select().from(replicas).where(eq(replicas.organizationId, organizationId)).all(),
        catch: (cause) => persistenceFail("countReplicas", cause),
      });
      return rows.length;
    }),
    countReceipts: Effect.fn("Migrate.Target.countReceipts")(function* (
      organizationId: OrganizationId,
    ) {
      const rows = yield* Effect.try({
        try: () =>
          db
            .select()
            .from(commandReceipts)
            .where(eq(commandReceipts.organizationId, organizationId))
            .all(),
        catch: (cause) => persistenceFail("countReceipts", cause),
      });
      return rows.length;
    }),
    markReady: Effect.fn("Migrate.Target.markReady")(function* (
      organizationId: OrganizationId,
      importId: InventoryImportId,
    ) {
      yield* Effect.try({
        try: () =>
          runSqliteTransaction(sqlite, () => {
            const state = db
              .select()
              .from(inventoryState)
              .where(eq(inventoryState.organizationId, organizationId))
              .get();
            if (state !== undefined && state.status === "ready" && state.importId === importId) {
              return;
            }
            requireImporting(organizationId, importId, "markReady");
            db.update(inventoryState)
              .set({ status: "ready" })
              .where(eq(inventoryState.organizationId, organizationId))
              .run();
          }),
        catch: (cause) => {
          if (cause instanceof ImportRejected) return cause;
          return persistenceFail("markReady", cause);
        },
      });
    }),
    readImportState: Effect.fn("Migrate.Target.readImportState")(function* (
      organizationId: OrganizationId,
    ) {
      const state = yield* Effect.try({
        try: () =>
          db
            .select()
            .from(inventoryState)
            .where(eq(inventoryState.organizationId, organizationId))
            .get(),
        catch: (cause) => persistenceFail("readImportState", cause),
      });
      if (state === undefined) {
        return ImportObjectStateSchema.cases.empty.make({ organizationId });
      }
      if (state.status === "importing") {
        return yield* Schema.decodeUnknownEffect(ImportObjectStateSchema)({
          _tag: "importing",
          organizationId: state.organizationId,
          importId: state.importId,
          epoch: state.epoch,
          incarnation: state.incarnation,
        }).pipe(Effect.mapError((cause) => persistenceFail("readImportState", cause)));
      }
      return yield* Schema.decodeUnknownEffect(ImportObjectStateSchema)({
        _tag: "ready",
        organizationId: state.organizationId,
        importId: state.importId,
        epoch: state.epoch,
        incarnation: state.incarnation,
      }).pipe(Effect.mapError((cause) => persistenceFail("readImportState", cause)));
    }),
  };
};

export const sqliteTargetLayer = (
  sqlite: Database.Database,
): Layer.Layer<OrganizationInventoryImport> =>
  Layer.sync(OrganizationInventoryImport, () => {
    migrateInventoryAuthority(sqlite);
    return OrganizationInventoryImport.of(makeTarget(sqlite));
  });
