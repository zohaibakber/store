import { sql } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import type { InventoryError } from "./errors";
import { databaseError, runStatement, type InventoryDrizzle } from "./postgres";
import { SNAPSHOT_POLICY } from "./snapshots";

const MaintenancePolicy = Schema.Struct({
  budgetMillis: Schema.Number,
  organizationsPerRun: Schema.Number,
  partRows: Schema.Number,
  minimumRetainedTransactions: Schema.Number,
  deleteBatchTransactions: Schema.Number,
  deleteBatchesPerStep: Schema.Number,
  expiredLeaseBatchRows: Schema.Number,
  retainedPublishedSnapshots: Schema.Number,
  prunedSnapshotsPerStep: Schema.Number,
  snapshotRowDeleteBatchRows: Schema.Number,
  lagTransactions: Schema.Number,
  minimumRebuildMillis: Schema.Number,
  abandonedImportMillis: Schema.Number,
  abandonedImportBatchParts: Schema.Number,
});
export type MaintenancePolicy = typeof MaintenancePolicy.Type;

export const MAINTENANCE_POLICY = {
  cronExpression: "*/5 * * * *",
  budgetMillis: 5_000,
  organizationsPerRun: 100,
  partRows: SNAPSHOT_POLICY.partRows,
  minimumRetainedTransactions: 10_000,
  deleteBatchTransactions: 500,
  deleteBatchesPerStep: 4,
  expiredLeaseBatchRows: 200,
  retainedPublishedSnapshots: 2,
  prunedSnapshotsPerStep: 5,
  snapshotRowDeleteBatchRows: 500,
  lagTransactions: SNAPSHOT_POLICY.lagTransactions,
  minimumRebuildMillis: SNAPSHOT_POLICY.minimumRebuildMillis,
  abandonedImportMillis: 24 * 60 * 60_000,
  abandonedImportBatchParts: 64,
} as const satisfies MaintenancePolicy & { readonly cronExpression: string };

const OrganizationMaintenance = Schema.Struct({
  organizationId: Schema.String,
  floorBefore: Schema.String,
  floorAfter: Schema.String,
  deletedTransactions: Schema.Number,
  expiredLeases: Schema.Number,
  prunedSnapshots: Schema.Number,
  builtSnapshot: Schema.Boolean,
  more: Schema.Boolean,
});

const MaintenanceFailure = Schema.Struct({
  organizationId: Schema.NullOr(Schema.String),
  error: Schema.String,
});

export const MaintenanceSummary = Schema.Struct({
  organizations: Schema.Number,
  published: Schema.Number,
  retention: Schema.Array(OrganizationMaintenance),
  failures: Schema.Array(MaintenanceFailure),
  sweptImportParts: Schema.Number,
  more: Schema.Boolean,
  elapsedMillis: Schema.Number,
});
export type MaintenanceSummary = typeof MaintenanceSummary.Type;

const makeMaintain = (db: InventoryDrizzle) =>
  SqlSchema.findOne({
    Request: Schema.Struct({
      policy: Schema.fromJsonString(MaintenancePolicy),
      now: Schema.Number,
    }),
    Result: Schema.Struct({ summary: Schema.fromJsonString(MaintenanceSummary) }),
    execute: ({ policy, now }) =>
      db.execute(
        sql`select "sync"."maintain"(${policy}::jsonb, ${now}::bigint)::text as "summary"`,
        "objects",
      ),
  });

interface InventoryMaintenanceContract {
  readonly runScheduled: () => Effect.Effect<MaintenanceSummary, InventoryError>;
}

export const makeInventoryMaintenance = (
  db: InventoryDrizzle,
  policy: MaintenancePolicy = MAINTENANCE_POLICY,
): InventoryMaintenanceContract => {
  const maintain = makeMaintain(db);
  return {
    runScheduled: Effect.fn("InventoryMaintenance.runScheduled")(function* () {
      const now = yield* Clock.currentTimeMillis;
      const { summary } = yield* maintain({ policy, now }).pipe(
        Effect.catchTag("NoSuchElementError", () =>
          Effect.fail(databaseError(new Error("Maintenance returned no summary."))),
        ),
        runStatement,
      );
      if (summary.failures.length > 0) {
        yield* Effect.logWarning("inventory maintenance failures", summary.failures);
      }
      return summary;
    }),
  };
};
