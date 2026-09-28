import * as PgClient from "@effect/sql-pg/PgClient";
import {
  CATALOG_PARTITION_DIGEST_VERSION,
  isCatalogPartitionEntity,
  MAX_TRANSPORT_PAYLOAD_BYTES,
  OPERATIONAL_SUBSCRIPTION,
  PARTITION_DIGEST_VERSION,
  PartitionDigestReport,
  partitionDigestOf,
  SnapshotId,
  SnapshotPartPayload,
  SyncEpoch,
  type AcquireSnapshotRequest,
  type AcquireSnapshotResult,
  type SnapshotManifest,
  type SnapshotRow,
} from "@store/contracts";
import { LAST_UNIT_EPOCH, LAST_UNIT_REPLICA_A } from "@store/contracts/sync/fixtures";
import { sql } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { InventoryActor } from "../../src/inventory/model";
import type { InventoryDrizzle } from "../../src/inventory/postgres";
import {
  makeInventorySnapshots,
  SNAPSHOT_POLICY,
  type SnapshotPolicy,
} from "../../src/inventory/snapshots";
import { startAuthorityPostgres, type AuthorityPostgres } from "./authority-postgres";

const HISTORY_MIGRATION = "20260928150000_history_snapshots";

const decodeJsonText = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const TextRows = Schema.Array(Schema.Struct({ value: Schema.String }));
const decodeTextRows = Schema.decodeUnknownSync(TextRows);
const DigestText = Schema.fromJsonString(PartitionDigestReport);
const decodeDigestText = Schema.decodeUnknownSync(DigestText);
const decodePageDigest = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ digest: Schema.optionalKey(Schema.Unknown) })),
);

const seedStatements = (
  organizationId: string,
  history: { readonly invoices: number; readonly itemsPerInvoice: number },
): ReadonlyArray<string> => {
  const org = `'${organizationId}'`;
  const meta = `${org}, 'user-1', 'user-1', '${LAST_UNIT_REPLICA_A}'`;
  return [
    `INSERT INTO "inventory_state" ("organization_id", "status", "import_id", "release_id", "incarnation", "epoch", "commit_sequence", "retention_floor")
     VALUES (${org}, 'ready', 'import-test', 'release-test', 'incarnation-test', '${LAST_UNIT_EPOCH}', 2, 0)`,
    `INSERT INTO "replicas" ("organization_id", "replica_id", "owner_user_id", "device_label", "last_client_sequence", "processed_through_client_sequence", "registered_at", "last_seen_at")
     VALUES (${org}, '${LAST_UNIT_REPLICA_A}', 'user-1', 'desk', 0, 0, 1, 1)`,
    `INSERT INTO "categories" ("id", "name", "tracks_packs", "created_at", "updated_at", "organization_id", "created_by_user_id", "updated_by_user_id", "device_id", "operation_id", "row_version")
     VALUES ('general', 'General', true, 1, 1, ${meta}, 'seed-category', 1)`,
    `INSERT INTO "products" ("id", "name", "category_id", "created_at", "updated_at", "organization_id", "created_by_user_id", "updated_by_user_id", "device_id", "operation_id", "row_version")
     SELECT 'product-' || p, 'Product ' || p, 'general', 1, 1, ${meta}, 'seed-product', p FROM generate_series(1, 3) AS p`,
    `INSERT INTO "batches" ("id", "product_id", "batch_number", "pack_quantity", "unit_quantity", "created_at", "updated_at", "organization_id", "created_by_user_id", "updated_by_user_id", "device_id", "operation_id", "row_version")
     SELECT 'batch-' || p, 'product-' || p, 'B-' || p, 0, 1000, 1, 1, ${meta}, 'seed-batch', 1 FROM generate_series(1, 3) AS p`,
    `INSERT INTO "invoices" ("id", "invoice_number", "customer_name", "total", "created_at", "updated_at", "organization_id", "created_by_user_id", "updated_by_user_id", "device_id", "operation_id", "row_version")
     SELECT 'inv-' || lpad(g::text, 6, '0'), g, CASE WHEN g % 2 = 0 THEN 'Customer "' || g || '"' END, 100 * g, 1700000000000 + g, 1700000000000 + g, ${meta}, 'sale-' || g, 1
     FROM generate_series(1, ${history.invoices}) AS g`,
    `INSERT INTO "invoice_items" ("id", "invoice_id", "product_id", "batch_id", "product_name", "batch_number", "quantity", "quantity_type", "base_unit_quantity", "sale_price", "created_at", "updated_at", "organization_id", "created_by_user_id", "updated_by_user_id", "device_id", "operation_id", "row_version")
     SELECT 'item-' || lpad(g::text, 6, '0') || '-' || k, 'inv-' || lpad(g::text, 6, '0'), 'product-' || (1 + k % 3), 'batch-' || (1 + k % 3), 'Product ' || (1 + k % 3), 'B-' || (1 + k % 3), 1, 'unit', 1, 100, 1700000000000 + g, 1700000000000 + g, ${meta}, 'sale-' || g, 1
     FROM generate_series(1, ${history.invoices}) AS g, generate_series(1, ${history.itemsPerInvoice}) AS k`,
    `INSERT INTO "stock_movements" ("id", "product_id", "batch_id", "invoice_id", "type", "pack_delta", "unit_delta", "note", "organization_id", "actor_user_id", "device_id", "operation_id", "created_at")
     SELECT 'move-' || lpad(g::text, 6, '0') || '-' || k, 'product-' || (1 + k % 3), 'batch-' || (1 + k % 3), 'inv-' || lpad(g::text, 6, '0'), 'sale', 0, -1, NULL, ${org}, 'user-1', '${LAST_UNIT_REPLICA_A}', 'sale-' || g, 1700000000000 + g
     FROM generate_series(1, ${history.invoices}) AS g, generate_series(1, ${history.itemsPerInvoice}) AS k`,
  ];
};

const layerFor = (database: AuthorityPostgres) =>
  PgClient.layer({
    url: Redacted.make(database.connectionString),
    maxConnections: 4,
    applicationName: "tabaaq-history-snapshot-tests",
  });

const runWith =
  (database: () => AuthorityPostgres) =>
  <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layerFor(database())), Effect.scoped));

const openDb = Effect.gen(function* () {
  const client = yield* PgClient.PgClient;
  return yield* PgDrizzle.makeWithDefaults().pipe(Effect.provideService(PgClient.PgClient, client));
});

const seed = (
  db: InventoryDrizzle,
  organizationId: string,
  history: { readonly invoices: number; readonly itemsPerInvoice: number },
) =>
  Effect.forEach(seedStatements(organizationId, history), (statement) =>
    db.execute(sql.raw(statement)),
  );

const actorFor = (organizationId: string): InventoryActor => ({ organizationId, userId: "user-1" });

const legacyRequest: AcquireSnapshotRequest = {
  epoch: SyncEpoch.make(LAST_UNIT_EPOCH),
  subscription: OPERATIONAL_SUBSCRIPTION,
  replicaId: LAST_UNIT_REPLICA_A,
};

const historyRequest: AcquireSnapshotRequest = {
  ...legacyRequest,
  digestVersion: PARTITION_DIGEST_VERSION,
};

const readyManifest = (result: AcquireSnapshotResult) => {
  if (result._tag !== "ready") throw new Error("expected a ready snapshot");
  return result.manifest;
};

const readParts = (
  snapshots: ReturnType<typeof makeInventorySnapshots>,
  actor: InventoryActor,
  manifest: SnapshotManifest,
) =>
  Effect.forEach(manifest.parts, (part) =>
    snapshots.readSnapshotPartEncoded(actor, manifest.snapshotId, part.partNumber).pipe(
      Effect.map((encoded) => ({
        byteLength: Buffer.byteLength(encoded.json, "utf8"),
        payload: Schema.decodeUnknownSync(Schema.fromJsonString(SnapshotPartPayload))(encoded.json),
      })),
    ),
  );

const leavesOf = (rows: ReadonlyArray<SnapshotRow>) =>
  rows.map((row) => ({ entity: row.entity, entityId: row.entityId, rowVersion: row.rowVersion }));

const serverDigest = (db: InventoryDrizzle, organizationId: string, version: number) =>
  db
    .execute(
      sql`select "sync"."partition_digest"(${organizationId}, ${version}::integer)::text as "value"`,
      "objects",
    )
    .pipe(Effect.map((rows) => decodeDigestText(decodeTextRows(rows)[0]?.value)));

describe("postgres history snapshots", () => {
  let database: AuthorityPostgres;
  const run = runWith(() => database);

  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  it("serves history to new clients and the unchanged catalog view to v0.3.102 clients", async () => {
    const organizationId = "org-history-views";
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* openDb;
        yield* seed(db, organizationId, { invoices: 40, itemsPerInvoice: 2 });
        const snapshots = makeInventorySnapshots(db, { ...SNAPSHOT_POLICY, partRows: 50 });
        const history = readyManifest(yield* snapshots.acquireSnapshot(actor, historyRequest));
        const legacy = readyManifest(yield* snapshots.acquireSnapshot(actor, legacyRequest));
        const rawLegacy = yield* db.execute(
          sql`select "sync"."acquire_snapshot"(${organizationId}, ${LAST_UNIT_REPLICA_A}, 'user-1', ${LAST_UNIT_EPOCH}, 'operational', 1, 50, 60000)::text as "value"`,
          "objects",
        );
        return {
          history,
          legacy,
          rawLegacy: decodeJsonText(decodeTextRows(rawLegacy)[0]?.value),
          historyParts: yield* readParts(snapshots, actor, history),
          legacyParts: yield* readParts(snapshots, actor, legacy),
          digest: yield* serverDigest(db, organizationId, PARTITION_DIGEST_VERSION),
        };
      }),
    );
    expect(outcome.history.snapshotId).toBe(outcome.legacy.snapshotId);
    expect(outcome.history.digestVersion).toBe(PARTITION_DIGEST_VERSION);
    expect(outcome.history.entityCounts).toEqual([
      { entity: "category", rowCount: 1 },
      { entity: "product", rowCount: 3 },
      { entity: "batch", rowCount: 3 },
      { entity: "invoice", rowCount: 40 },
      { entity: "invoiceItem", rowCount: 80 },
      { entity: "stockMovement", rowCount: 80 },
    ]);
    const historyRows = outcome.historyParts.flatMap((part) => part.payload.rows);
    expect(historyRows.map((row) => row.entity)).toEqual([
      "category",
      ...Array.from({ length: 3 }, () => "product"),
      ...Array.from({ length: 3 }, () => "batch"),
      ...Array.from({ length: 40 }, () => "invoice"),
      ...Array.from({ length: 80 }, () => "invoiceItem"),
      ...Array.from({ length: 80 }, () => "stockMovement"),
    ]);
    expect(
      historyRows.filter((row) => row.entity === "stockMovement").map((row) => row.rowVersion),
    ).toEqual(Array.from({ length: 80 }, () => 1));
    for (const part of outcome.historyParts) {
      const kinds = new Set(part.payload.rows.map((row) => isCatalogPartitionEntity(row.entity)));
      expect(kinds.size).toBeLessThanOrEqual(1);
      expect(part.payload.rows.length).toBeLessThanOrEqual(50);
    }
    expect(await Effect.runPromise(partitionDigestOf(leavesOf(historyRows)))).toEqual(
      outcome.digest,
    );

    expect(Object.keys(outcome.legacy).sort()).toEqual([
      "entityCounts",
      "epoch",
      "horizon",
      "parts",
      "schemaVersion",
      "snapshotId",
      "subscription",
    ]);
    expect(outcome.legacy.entityCounts).toEqual([
      { entity: "category", rowCount: 1 },
      { entity: "product", rowCount: 3 },
      { entity: "batch", rowCount: 3 },
    ]);
    expect(outcome.legacy.parts).toEqual(outcome.history.parts.slice(0, 1));
    expect(outcome.legacyParts.flatMap((part) => part.payload.rows)).toEqual(
      historyRows.filter((row) => isCatalogPartitionEntity(row.entity)),
    );
    expect(outcome.rawLegacy).toEqual({ _tag: "ready", manifest: outcome.legacy });
  });

  it("bounds every part by the byte budget and never mixes catalog and history rows", async () => {
    const organizationId = "org-history-bytes";
    const actor = actorFor(organizationId);
    const policy: SnapshotPolicy = { ...SNAPSHOT_POLICY, partBytes: 8_192 };
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* openDb;
        yield* seed(db, organizationId, { invoices: 60, itemsPerInvoice: 3 });
        const snapshots = makeInventorySnapshots(db, policy);
        const manifest = readyManifest(yield* snapshots.acquireSnapshot(actor, historyRequest));
        return { manifest, parts: yield* readParts(snapshots, actor, manifest) };
      }),
    );
    const rows = outcome.parts.flatMap((part) => part.payload.rows);
    expect(rows).toHaveLength(7 + 60 + 180 + 180);
    const largestFrame = Math.max(...rows.map((row) => Buffer.byteLength(JSON.stringify(row))));
    for (const part of outcome.parts) {
      expect(part.byteLength).toBeLessThanOrEqual(policy.partBytes + largestFrame + 256);
      const kinds = new Set(part.payload.rows.map((row) => isCatalogPartitionEntity(row.entity)));
      expect(kinds.size).toBe(1);
    }
    expect(outcome.parts.length).toBeGreaterThan(10);
    expect(outcome.manifest.parts.map((part) => part.partNumber)).toEqual(
      outcome.parts.map((_, index) => index + 1),
    );
  });

  it("publishes an empty catalog part when only history remains", async () => {
    const organizationId = "org-history-only";
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* openDb;
        yield* seed(db, organizationId, { invoices: 2, itemsPerInvoice: 1 });
        yield* db.execute(
          sql`update "batches" set "deleted_at" = 5 where "organization_id" = ${organizationId}`,
        );
        yield* db.execute(
          sql`update "products" set "deleted_at" = 5 where "organization_id" = ${organizationId}`,
        );
        yield* db.execute(
          sql`delete from "categories" where "organization_id" = ${organizationId}`,
        );
        const snapshots = makeInventorySnapshots(db);
        const history = readyManifest(yield* snapshots.acquireSnapshot(actor, historyRequest));
        const legacy = readyManifest(yield* snapshots.acquireSnapshot(actor, legacyRequest));
        return {
          history,
          legacy,
          historyParts: yield* readParts(snapshots, actor, history),
          legacyParts: yield* readParts(snapshots, actor, legacy),
        };
      }),
    );
    expect(outcome.legacy.parts).toHaveLength(1);
    expect(outcome.legacyParts[0]?.payload.rows).toEqual([]);
    expect(outcome.historyParts.map((part) => part.payload.rows.length)).toEqual([0, 6]);
  });

  it("imports 5k invoices, 20k items and 20k movements into transport-sized parts in one statement", async () => {
    const organizationId = "org-history-volume";
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* openDb;
        yield* seed(db, organizationId, { invoices: 5_000, itemsPerInvoice: 4 });
        const snapshots = makeInventorySnapshots(db);
        const started = performance.now();
        const manifest = readyManifest(yield* snapshots.acquireSnapshot(actor, historyRequest));
        const buildMillis = performance.now() - started;
        const parts = yield* readParts(snapshots, actor, manifest);
        const digestStarted = performance.now();
        const digest = yield* serverDigest(db, organizationId, PARTITION_DIGEST_VERSION);
        const digestMillis = performance.now() - digestStarted;
        return { manifest, parts, digest, buildMillis, digestMillis };
      }),
    );
    const rows = outcome.parts.flatMap((part) => part.payload.rows);
    expect(rows).toHaveLength(7 + 5_000 + 20_000 + 20_000);
    expect(outcome.manifest.entityCounts.at(-1)).toEqual({
      entity: "stockMovement",
      rowCount: 20_000,
    });
    for (const part of outcome.parts) {
      expect(part.byteLength).toBeLessThan(MAX_TRANSPORT_PAYLOAD_BYTES);
      expect(part.payload.rows.length).toBeLessThanOrEqual(SNAPSHOT_POLICY.partRows);
    }
    expect(await Effect.runPromise(partitionDigestOf(leavesOf(rows)))).toEqual(outcome.digest);
    console.info("history snapshot volume", {
      parts: outcome.parts.length,
      bytes: outcome.parts.reduce((total, part) => total + part.byteLength, 0),
      buildMillis: Math.round(outcome.buildMillis),
      digestMillis: Math.round(outcome.digestMillis),
    });
  }, 120_000);
});

describe("history snapshot migration", () => {
  const organizationId = "org-history-migration";
  let database: AuthorityPostgres;
  const run = runWith(() => database);

  beforeAll(async () => {
    database = await startAuthorityPostgres({
      seedBeforeMigration: {
        migration: HISTORY_MIGRATION,
        seed: async (query) => {
          for (const statement of seedStatements(organizationId, {
            invoices: 5,
            itemsPerInvoice: 2,
          })) {
            await query(statement);
          }
          await query(
            `CREATE TABLE "catalog_digest_before" AS SELECT "sync"."partition_digest"('${organizationId}')::text AS "value"`,
          );
          await query(
            `CREATE TABLE "legacy_snapshot" AS SELECT ("sync"."acquire_snapshot"('${organizationId}', '${LAST_UNIT_REPLICA_A}', 'user-1', '${LAST_UNIT_EPOCH}', 'operational', 1, 500, 900000) -> 'manifest' ->> 'snapshotId') AS "value"`,
          );
        },
      },
    });
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  it("keeps the catalog digest byte for byte and rebuilds legacy snapshots for history requests", async () => {
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* openDb;
        const textOf = (statement: ReturnType<typeof sql>) =>
          db
            .execute(statement, "objects")
            .pipe(Effect.map((rows) => decodeTextRows(rows)[0]?.value));
        const before = yield* textOf(sql`select "value" from "catalog_digest_before"`);
        const legacySnapshotId = yield* textOf(sql`select "value" from "legacy_snapshot"`);
        const afterOneArgument = yield* textOf(
          sql`select "sync"."partition_digest"(${organizationId})::text as "value"`,
        );
        const afterCatalog = yield* textOf(
          sql`select "sync"."partition_digest"(${organizationId}, 2)::text as "value"`,
        );
        const legacyPull = yield* db.execute(
          sql`select "body" as "value" from "sync"."pull"(${organizationId}, ${LAST_UNIT_EPOCH}, 'operational', '2', 100, 900000, true)`,
          "objects",
        );
        const legacyJob = yield* db.execute(
          sql`select "digest_version"::text as "value" from "snapshot_jobs" where "organization_id" = ${organizationId}`,
          "objects",
        );
        const snapshots = makeInventorySnapshots(db);
        const legacyView = readyManifest(yield* snapshots.acquireSnapshot(actor, legacyRequest));
        const historyView = readyManifest(yield* snapshots.acquireSnapshot(actor, historyRequest));
        const legacyParts = yield* readParts(snapshots, actor, legacyView);
        const oldSnapshotPart = yield* snapshots.readSnapshotPartEncoded(
          actor,
          SnapshotId.make(legacySnapshotId ?? ""),
          1,
        );
        return {
          before,
          legacySnapshotId,
          afterOneArgument,
          afterCatalog,
          legacyPullDigest: decodePageDigest(decodeTextRows(legacyPull)[0]?.value).digest,
          legacyJobs: decodeTextRows(legacyJob).map((row) => row.value),
          legacyView,
          historyView,
          legacyParts,
          oldSnapshotPart,
        };
      }),
    );
    expect(outcome.afterOneArgument).toBe(outcome.before);
    expect(outcome.afterCatalog).toBe(outcome.before);
    expect(outcome.legacyPullDigest).toEqual(decodeJsonText(outcome.before));
    expect(decodeDigestText(outcome.before).version).toBe(CATALOG_PARTITION_DIGEST_VERSION);
    expect(outcome.legacyJobs).toEqual(["2"]);
    expect(outcome.historyView.snapshotId).not.toBe(outcome.legacySnapshotId);
    expect(outcome.historyView.digestVersion).toBe(PARTITION_DIGEST_VERSION);
    expect(outcome.legacyView.snapshotId).toBe(outcome.historyView.snapshotId);
    expect(outcome.legacyView.digestVersion).toBeUndefined();
    expect(
      outcome.legacyParts.flatMap((part) => part.payload.rows.map((row) => row.entity)),
    ).toEqual(["category", "product", "product", "product", "batch", "batch", "batch"]);
    expect(outcome.oldSnapshotPart.json).toContain('"entity":"category"');
  });
});
