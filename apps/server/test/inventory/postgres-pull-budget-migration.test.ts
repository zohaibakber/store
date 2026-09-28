import * as PgClient from "@effect/sql-pg/PgClient";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startAuthorityPostgres, type AuthorityPostgres } from "./authority-postgres";
import { pullGroupByteLength } from "./oracle/commit";

const ORGANIZATION_ID = "org-pull-budget-migration";

let database: AuthorityPostgres;

const changes = [
  {
    entity: "product",
    entityId: "prod-naïve",
    rowJson: '{"id":"prod-naïve","name":"Crème brûlée ☕"}',
  },
  { entity: "batch", entityId: "batch-1", rowJson: '{"id":"batch-1","packQuantity":2}' },
];

const partPayload = JSON.stringify({
  snapshotId: "snap-old",
  partNumber: 1,
  rows: [
    { entity: "category", entityId: "general", rowVersion: 1, row: { id: "general" } },
    { entity: "product", entityId: "prod-1", rowVersion: 1, row: { id: "prod-1" } },
    { entity: "product", entityId: "prod-2", rowVersion: 1, row: { id: "prod-2" } },
  ],
});

const quoted = (value: string) => `'${value.replaceAll("'", "''")}'`;

const Headers = Schema.Array(
  Schema.Struct({ commitSequence: Schema.String, byteLength: Schema.Number }),
);
const Jobs = Schema.Array(
  Schema.Struct({ snapshotId: Schema.String, counts: Schema.NullOr(Schema.String) }),
);

const run = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        PgClient.layer({ url: Redacted.make(database.connectionString), maxConnections: 2 }),
      ),
      Effect.scoped,
    ),
  );

describe("postgres pull byte budget migration", () => {
  beforeAll(async () => {
    database = await startAuthorityPostgres({
      seedBeforeMigration: {
        migration: "20260927083409_pull_byte_budget_and_snapshot_counts",
        seed: async (query) => {
          await query(
            `INSERT INTO "inventory_transactions" ("organization_id", "commit_sequence", "operation_id", "decision", "epoch") VALUES ('${ORGANIZATION_ID}', 1, 'op-with-changes', 'accepted', '1'), ('${ORGANIZATION_ID}', 2, 'op-rejected', 'rejected', '1')`,
          );
          for (const [ordinal, change] of changes.entries()) {
            await query(
              `INSERT INTO "inventory_changes" ("organization_id", "commit_sequence", "ordinal", "entity", "action", "entity_id", "row_version", "row_json") VALUES ('${ORGANIZATION_ID}', 1, ${ordinal}, ${quoted(change.entity)}, 'upsert', ${quoted(change.entityId)}, 1, ${quoted(change.rowJson)})`,
            );
          }
          await query(
            `INSERT INTO "snapshot_jobs" ("organization_id", "snapshot_id", "subscription", "stage", "fence", "started_at_commit_sequence", "horizon", "step_due_at") VALUES ('${ORGANIZATION_ID}', 'snap-old', 'operational', 'published', 2, 1, 1, 1), ('${ORGANIZATION_ID}', 'snap-building', 'operational', 'copying', 0, 2, NULL, 1)`,
          );
          await query(
            `INSERT INTO "snapshot_parts" ("organization_id", "snapshot_id", "part_number", "object_key", "byte_length", "sha256", "payload_json") VALUES ('${ORGANIZATION_ID}', 'snap-old', 1, 'key', 1, 'sha', ${quoted(partPayload)})`,
          );
        },
      },
    });
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  it("backfills each group's pull-frame size and each published snapshot's entity counts", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const client = yield* PgClient.PgClient;
        const headers = yield* client.unsafe(
          `SELECT "commit_sequence"::text AS "commitSequence", "byte_length" AS "byteLength" FROM "inventory_transactions" WHERE "organization_id" = '${ORGANIZATION_ID}' ORDER BY "commit_sequence"`,
        );
        const jobs = yield* client.unsafe(
          `SELECT "snapshot_id" AS "snapshotId", "entity_counts_json" AS "counts" FROM "snapshot_jobs" WHERE "organization_id" = '${ORGANIZATION_ID}' ORDER BY "snapshot_id"`,
        );
        return {
          headers: Schema.decodeUnknownSync(Headers)(headers),
          jobs: Schema.decodeUnknownSync(Jobs)(jobs),
        };
      }),
    );
    expect(outcome.headers).toEqual([
      { commitSequence: "1", byteLength: pullGroupByteLength("op-with-changes", changes) },
      { commitSequence: "2", byteLength: pullGroupByteLength("op-rejected", []) },
    ]);
    expect(outcome.jobs.map((job) => job.snapshotId)).toEqual(["snap-old"]);
    expect(JSON.parse(outcome.jobs[0]?.counts ?? "null")).toEqual({ category: 1, product: 2 });
  });
});
