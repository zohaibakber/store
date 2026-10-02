import * as PgClient from "@effect/sql-pg/PgClient";
import {
  OPERATIONAL_SUBSCRIPTION,
  PARTITION_DIGEST_VERSION,
  PARTITION_DIGEST_VERSION_V3,
  PartitionDigestReport,
  partitionDigestOf,
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
import { makeInventorySnapshots, SNAPSHOT_POLICY } from "../../src/inventory/snapshots";
import { startAuthorityPostgres, type AuthorityPostgres } from "./authority-postgres";

const decodeJsonText = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const TextRows = Schema.Array(Schema.Struct({ value: Schema.String }));
const decodeTextRows = Schema.decodeUnknownSync(TextRows);
const DigestText = Schema.fromJsonString(PartitionDigestReport);
const decodeDigestText = Schema.decodeUnknownSync(DigestText);

const seedStatements = (
  organizationId: string,
  history: { readonly invoices: number; readonly itemsPerInvoice: number },
): ReadonlyArray<string> => {
  const org = `'${organizationId}'`;
  const meta = `${org}, 'user-1', 'user-1', '${LAST_UNIT_REPLICA_A}'`;
  return [
    `INSERT INTO "inventory_state" ("organization_id", "incarnation", "epoch", "commit_sequence", "retention_floor")
     VALUES (${org}, 'incarnation-test', '${LAST_UNIT_EPOCH}', 2, 0)`,
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

const historyRequest: AcquireSnapshotRequest = {
  epoch: SyncEpoch.make(LAST_UNIT_EPOCH),
  subscription: OPERATIONAL_SUBSCRIPTION,
  replicaId: LAST_UNIT_REPLICA_A,
};

const readyManifest = (result: AcquireSnapshotResult) => result.manifest;

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

const serverDigest = (db: InventoryDrizzle, organizationId: string) =>
  db
    .execute(
      sql`select "sync"."partition_digest"(${organizationId}, ${PARTITION_DIGEST_VERSION})::text as "value"`,
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

  it("serves catalog and history in one snapshot that matches the partition digest", async () => {
    const organizationId = "org-history-views";
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* openDb;
        yield* seed(db, organizationId, { invoices: 40, itemsPerInvoice: 2 });
        const snapshots = makeInventorySnapshots(db, { ...SNAPSHOT_POLICY, partRows: 50 });
        const history = readyManifest(yield* snapshots.acquireSnapshot(actor, historyRequest));
        const raw = yield* db.execute(
          sql`select "sync"."acquire_snapshot"(${organizationId}, ${LAST_UNIT_REPLICA_A}, 'user-1', ${LAST_UNIT_EPOCH}, 'operational', 1, 50, 60000)::text as "value"`,
          "objects",
        );
        return {
          history,
          raw: decodeJsonText(decodeTextRows(raw)[0]?.value),
          historyParts: yield* readParts(snapshots, actor, history),
          digest: yield* serverDigest(db, organizationId),
        };
      }),
    );
    expect(outcome.raw).toMatchObject({
      _tag: "ready",
      manifest: {
        snapshotId: outcome.history.snapshotId,
        parts: outcome.history.parts.map((part) => ({
          ...part,
          objectKey: `${organizationId}/${outcome.history.snapshotId}/${part.partNumber}`,
        })),
      },
    });
    expect(outcome.history.digestVersion).toBe(PARTITION_DIGEST_VERSION_V3);
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
      expect(part.payload.rows.length).toBeLessThanOrEqual(50);
    }
    expect(await Effect.runPromise(partitionDigestOf(leavesOf(historyRows)))).toEqual(
      outcome.digest,
    );
  });
});
