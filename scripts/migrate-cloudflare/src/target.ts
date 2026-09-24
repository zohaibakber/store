import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import {
  type AuthorityIncarnation,
  type InventoryImportId,
  type OrganizationId,
  padDecimalSequence,
} from "@store/contracts";
import { eq } from "drizzle-orm";
import * as SqliteDrizzle from "drizzle-orm/effect-sqlite-node";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

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
} from "./authority-schema.ts";
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
import { migrateInventoryAuthority, persistingAs } from "./sqlite.ts";

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

const persisting = (operation: string) =>
  persistingAs((cause) => persistenceFail(operation, cause));

type InventoryDb = Effect.Success<ReturnType<typeof SqliteDrizzle.makeWithDefaults>>;

const insertRows = (
  db: InventoryDb,
  table: BusinessTable,
  rows: ReadonlyArray<SqliteBusinessRow>,
) => {
  switch (table) {
    case "categories":
      return Effect.forEach(
        rows.filter(Schema.is(SqliteCategorySchema)),
        (row) => db.insert(categories).values({ ...row, tracksPacks: row.tracksPacks === 1 }),
        { discard: true },
      );
    case "products":
      return Effect.forEach(
        rows.filter(Schema.is(SqliteProductSchema)),
        (row) => db.insert(products).values({ ...row, visible: row.visible === 1 }),
        { discard: true },
      );
    case "batches":
      return Effect.forEach(
        rows.filter(Schema.is(SqliteBatchSchema)),
        (row) => db.insert(batches).values(row),
        { discard: true },
      );
    case "invoices":
      return Effect.forEach(
        rows.filter(Schema.is(SqliteInvoiceSchema)),
        (row) => db.insert(invoices).values(row),
        { discard: true },
      );
    case "invoice_items":
      return Effect.forEach(
        rows.filter(Schema.is(SqliteInvoiceItemSchema)),
        (row) => db.insert(invoiceItems).values(row),
        { discard: true },
      );
    case "stock_movements":
      return Effect.forEach(
        rows.filter(Schema.is(SqliteStockMovementSchema)),
        (row) => db.insert(stockMovements).values(row),
        { discard: true },
      );
    default:
      return casesHandled(table);
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
): Effect.Effect<ReadonlyArray<SqliteBusinessRow>, PersistenceError | TranslationFailed> => {
  const translate = <S extends Schema.Top & { readonly DecodingServices: never }>(
    schema: S,
    rows: ReadonlyArray<unknown>,
  ) =>
    Schema.decodeUnknownEffect(Schema.Array(schema))(rows).pipe(
      Effect.mapError((cause) => failTranslate(table, cause)),
    );
  const stored = persisting("readTable");
  switch (table) {
    case "categories":
      return stored(
        db.select().from(categories).where(eq(categories.organizationId, organizationId)).all(),
      ).pipe(
        Effect.flatMap((rows) =>
          translate(
            SqliteCategorySchema,
            rows.map((row) => ({ ...row, tracksPacks: sqliteFlag(row.tracksPacks) })),
          ),
        ),
      );
    case "products":
      return stored(
        db.select().from(products).where(eq(products.organizationId, organizationId)).all(),
      ).pipe(
        Effect.flatMap((rows) =>
          translate(
            SqliteProductSchema,
            rows.map((row) => ({ ...row, visible: sqliteFlag(row.visible) })),
          ),
        ),
      );
    case "batches":
      return stored(
        db.select().from(batches).where(eq(batches.organizationId, organizationId)).all(),
      ).pipe(Effect.flatMap((rows) => translate(SqliteBatchSchema, rows)));
    case "invoices":
      return stored(
        db.select().from(invoices).where(eq(invoices.organizationId, organizationId)).all(),
      ).pipe(Effect.flatMap((rows) => translate(SqliteInvoiceSchema, rows)));
    case "invoice_items":
      return stored(
        db.select().from(invoiceItems).where(eq(invoiceItems.organizationId, organizationId)).all(),
      ).pipe(Effect.flatMap((rows) => translate(SqliteInvoiceItemSchema, rows)));
    case "stock_movements":
      return stored(
        db
          .select()
          .from(stockMovements)
          .where(eq(stockMovements.organizationId, organizationId))
          .all(),
      ).pipe(Effect.flatMap((rows) => translate(SqliteStockMovementSchema, rows)));
    default:
      return casesHandled(table);
  }
};

const makeTarget = (
  sql: SqliteClient.SqliteClient,
  db: InventoryDb,
): OrganizationInventoryImportApi => {
  const selectApplied = SqlSchema.findOneOption({
    Request: Schema.Struct({
      organizationId: Schema.String,
      table: Schema.String,
      chunkIndex: Schema.Number,
    }),
    Result: Schema.Struct({ checksum: Schema.String }),
    execute: (key) =>
      sql`select checksum from import_applied_chunks where organization_id = ${key.organizationId} and table_name = ${key.table} and chunk_index = ${key.chunkIndex}`,
  });
  const readState = (organizationId: OrganizationId) =>
    db.select().from(inventoryState).where(eq(inventoryState.organizationId, organizationId)).get();
  const requireImporting = (
    organizationId: OrganizationId,
    importId: InventoryImportId,
    operation: string,
  ) =>
    Effect.gen(function* () {
      const state = yield* readState(organizationId);
      if (state === undefined) {
        return yield* new ImportRejected({
          organizationId,
          message: `Inventory object is empty during ${operation}.`,
        });
      }
      if (state.status !== "importing" || state.importId !== importId) {
        return yield* new ImportRejected({
          organizationId,
          message: `Inventory object is not an importing target for ${importId}.`,
        });
      }
    });

  return {
    prepareImport: Effect.fn("Migrate.Target.prepareImport")(function* (
      organizationId: OrganizationId,
      importId: InventoryImportId,
      incarnation: AuthorityIncarnation,
    ) {
      yield* Effect.gen(function* () {
        const state = yield* readState(organizationId);
        if (state === undefined) {
          yield* db.insert(inventoryState).values({
            organizationId,
            status: "importing",
            importId,
            releaseId: null,
            incarnation,
            epoch: INITIAL_SYNC_EPOCH,
            commitSequence: padDecimalSequence("0"),
            retentionFloor: padDecimalSequence("0"),
          });
          return;
        }
        if (state.status === "ready") {
          if (state.importId === importId) return;
          return yield* new ImportRejected({
            organizationId,
            message: "Import attempts against an already active target are rejected.",
          });
        }
        if (state.importId !== importId) {
          return yield* new ImportRejected({
            organizationId,
            message: "Inventory object is already importing a different dataset.",
          });
        }
      }).pipe(sql.withTransaction);
    }, persisting("prepareImport")),
    applyChunk: Effect.fn("Migrate.Target.applyChunk")(function* (
      organizationId: OrganizationId,
      importId: InventoryImportId,
      table: BusinessTable,
      chunkIndex: number,
      checksum: Sha256Hex,
      rowsJson: string,
    ) {
      const rows = yield* decodeChunkRows(table, rowsJson);
      const mismatch = new ChunkContentMismatch({
        organizationId,
        table,
        chunkIndex,
        message: "Imported chunk identity collided with different bytes.",
      });
      if (rowsChecksum(rows) !== checksum) return yield* mismatch;
      if (!rows.every((row) => row.organizationId === organizationId)) {
        return yield* new ImportRejected({
          organizationId,
          message: `Chunk ${table} ${String(chunkIndex)} contains a foreign organization.`,
        });
      }
      return yield* Effect.gen(function* () {
        const existing = yield* selectApplied({ organizationId, table, chunkIndex });
        if (Option.isSome(existing)) {
          if (existing.value.checksum !== checksum) return yield* mismatch;
          return ApplyChunkOutcomeSchema.cases.duplicate.make({});
        }
        yield* requireImporting(organizationId, importId, "applyChunk");
        yield* insertRows(db, table, rows);
        yield* sql`insert into import_applied_chunks (organization_id, table_name, chunk_index, checksum) values (${organizationId}, ${table}, ${chunkIndex}, ${checksum})`;
        return ApplyChunkOutcomeSchema.cases.applied.make({});
      }).pipe(sql.withTransaction);
    }, persisting("applyChunk")),
    readTable: Effect.fn("Migrate.Target.readTable")(function* (
      organizationId: OrganizationId,
      table: BusinessTable,
    ) {
      return yield* readRows(db, organizationId, table);
    }),
    countReplicas: Effect.fn("Migrate.Target.countReplicas")(function* (
      organizationId: OrganizationId,
    ) {
      const rows = yield* db
        .select()
        .from(replicas)
        .where(eq(replicas.organizationId, organizationId))
        .all();
      return rows.length;
    }, persisting("countReplicas")),
    countReceipts: Effect.fn("Migrate.Target.countReceipts")(function* (
      organizationId: OrganizationId,
    ) {
      const rows = yield* db
        .select()
        .from(commandReceipts)
        .where(eq(commandReceipts.organizationId, organizationId))
        .all();
      return rows.length;
    }, persisting("countReceipts")),
    markReady: Effect.fn("Migrate.Target.markReady")(function* (
      organizationId: OrganizationId,
      importId: InventoryImportId,
    ) {
      yield* Effect.gen(function* () {
        const state = yield* readState(organizationId);
        if (state !== undefined && state.status === "ready" && state.importId === importId) {
          return;
        }
        yield* requireImporting(organizationId, importId, "markReady");
        yield* db
          .update(inventoryState)
          .set({ status: "ready" })
          .where(eq(inventoryState.organizationId, organizationId));
      }).pipe(sql.withTransaction);
    }, persisting("markReady")),
    readImportState: Effect.fn("Migrate.Target.readImportState")(function* (
      organizationId: OrganizationId,
    ) {
      const state = yield* readState(organizationId);
      if (state === undefined) {
        return ImportObjectStateSchema.cases.empty.make({ organizationId });
      }
      return yield* Schema.decodeUnknownEffect(ImportObjectStateSchema)({
        _tag: state.status === "importing" ? "importing" : "ready",
        organizationId: state.organizationId,
        importId: state.importId,
        epoch: state.epoch,
        incarnation: state.incarnation,
      });
    }, persisting("readImportState")),
  };
};

export const sqliteTargetLayer = (
  sql: SqliteClient.SqliteClient,
): Layer.Layer<OrganizationInventoryImport> =>
  Layer.effect(
    OrganizationInventoryImport,
    Effect.gen(function* () {
      yield* migrateInventoryAuthority(sql).pipe(Effect.orDie);
      const db = yield* SqliteDrizzle.makeWithDefaults().pipe(
        Effect.provideService(SqliteClient.SqliteClient, sql),
      );
      return OrganizationInventoryImport.of(makeTarget(sql, db));
    }),
  );
