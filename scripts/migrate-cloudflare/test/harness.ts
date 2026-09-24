import type * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { decodeOrganizationId, InventoryObjectName } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";

import { testCheckpointLayer } from "../src/checkpoint.ts";
import { sqliteDirectoryTestLayer } from "../src/directory.ts";
import { journalLayerFromSqlite } from "../src/export-store.ts";
import { fixedIdsLayer } from "../src/ids.ts";
import { type DriverRow, type MigrationRequest, SourceIdentity } from "../src/model.ts";
import { inMemorySourceLayer, type SourceTableRows } from "../src/source.ts";
import { openSqlite } from "../src/sqlite.ts";
import { sqliteTargetLayer } from "../src/target.ts";
import { runMigration } from "../src/workflow.ts";

export const ORG = decodeOrganizationId("org-1");
const OBJECT_NAME = Schema.decodeUnknownSync(InventoryObjectName)("inventory-org-1");
const SOURCE_IDENTITY = "pg-fixture";
export const PUBLISHED_AT = 1_700_000_000_000;

export const request: MigrationRequest = {
  sourceIdentity: Schema.decodeUnknownSync(SourceIdentity)(SOURCE_IDENTITY),
  organizations: [
    {
      organizationId: ORG,
      objectName: OBJECT_NAME,
    },
  ],
  chunkSize: 2,
};

const META = {
  organizationId: ORG,
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: "device-1",
  operationId: "op-seed",
  rowVersion: 1,
  createdAt: PUBLISHED_AT,
  updatedAt: PUBLISHED_AT,
  deletedAt: null,
};

const category = (id: string, name: string, tracksPacks: boolean): DriverRow => ({
  id,
  name,
  tracksPacks,
  ...META,
  operationId: `op-cat-${id}`,
});

const fixtureRows: SourceTableRows = {
  categories: [
    category("cat-1", "General", true),
    category("cat-2", "Loose", false),
    category("cat-3", "Extra", true),
  ],
  products: [
    {
      id: "prod-1",
      name: "Aspirin",
      categoryId: "cat-1",
      aisle: "A1",
      composition: "ASA",
      strength: "100mg",
      unitsPerPack: 10,
      purchasePrice: 50,
      retailPrice: 100,
      unitPrice: 10,
      visible: true,
      ...META,
      operationId: "op-prod-1",
    },
  ],
  batches: [
    {
      id: "batch-1",
      productId: "prod-1",
      batchNumber: "B-1",
      expiresAt: PUBLISHED_AT + 86_400_000,
      packQuantity: 2,
      unitQuantity: 5,
      ...META,
      operationId: "op-batch-1",
    },
  ],
  invoices: [
    {
      id: "inv-1",
      invoiceNumber: 1,
      customerName: "Ada",
      total: 200,
      ...META,
      operationId: "op-inv-1",
    },
  ],
  invoice_items: [
    {
      id: "item-1",
      invoiceId: "inv-1",
      productId: "prod-1",
      batchId: "batch-1",
      productName: "Aspirin",
      batchNumber: "B-1",
      quantity: 2,
      quantityType: "pack",
      baseUnitQuantity: 20,
      salePrice: 100,
      ...META,
      operationId: "op-item-1",
    },
  ],
  stock_movements: [
    {
      id: "mov-1",
      productId: "prod-1",
      batchId: "batch-1",
      invoiceId: null,
      type: "stock_in",
      packDelta: 3,
      unitDelta: 5,
      note: "opening",
      organizationId: ORG,
      actorUserId: "user-1",
      deviceId: "device-1",
      operationId: "op-mov-1",
      createdAt: PUBLISHED_AT,
    },
    {
      id: "mov-2",
      productId: "prod-1",
      batchId: "batch-1",
      invoiceId: "inv-1",
      type: "sale",
      packDelta: -1,
      unitDelta: 0,
      note: null,
      organizationId: ORG,
      actorUserId: "user-1",
      deviceId: "device-1",
      operationId: "op-mov-2",
      createdAt: PUBLISHED_AT + 1,
    },
  ],
};

const buildLayer = (
  journal: SqliteClient.SqliteClient,
  target: SqliteClient.SqliteClient,
  directory: SqliteClient.SqliteClient,
) =>
  Layer.mergeAll(
    journalLayerFromSqlite(journal),
    sqliteTargetLayer(target),
    sqliteDirectoryTestLayer(directory),
    inMemorySourceLayer({ identity: SOURCE_IDENTITY, rows: fixtureRows }),
    fixedIdsLayer({
      migrationId: "migration-fixed",
      importId: "import-fixed",
      releaseId: "release-fixed",
      incarnation: "incarnation-fixed",
    }),
    testCheckpointLayer,
  );

export type Harness = {
  readonly journal: SqliteClient.SqliteClient;
  readonly target: SqliteClient.SqliteClient;
  readonly directory: SqliteClient.SqliteClient;
  readonly layer: ReturnType<typeof buildLayer>;
};

export const openHarness = Effect.gen(function* () {
  const journal = yield* openSqlite(":memory:");
  const target = yield* openSqlite(":memory:");
  const directory = yield* openSqlite(":memory:");
  return {
    journal,
    target,
    directory,
    layer: buildLayer(journal, target, directory),
  } satisfies Harness;
});

export const firstRow = (
  sql: SqliteClient.SqliteClient,
  statement: string,
  parameters: ReadonlyArray<string> = [],
) =>
  sql.unsafe(statement, parameters).pipe(
    Effect.map((rows) => rows[0]),
    Effect.orDie,
  );

export const allRows = (sql: SqliteClient.SqliteClient, statement: string) =>
  sql.unsafe(statement).pipe(Effect.orDie);

export const runOn = (harness: Harness) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(PUBLISHED_AT);
    return yield* runMigration(request);
  }).pipe(Effect.provide(harness.layer));
