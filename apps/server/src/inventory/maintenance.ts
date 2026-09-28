import { sql } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { InventoryError } from "./errors";
import {
  databaseError,
  inventoryPostgresUnavailable,
  runStatement,
  type InventoryDrizzle,
} from "./postgres";
import { SNAPSHOT_POLICY } from "./snapshots";

export type MaintenancePolicy = {
  readonly budgetMillis: number;
  readonly organizationsPerRun: number;
  readonly partRows: number;
  readonly minimumRetainedTransactions: number;
  readonly deleteBatchTransactions: number;
  readonly deleteBatchesPerStep: number;
  readonly expiredLeaseBatchRows: number;
  readonly expiredTicketBatchRows: number;
  readonly retainedPublishedSnapshots: number;
  readonly prunedSnapshotsPerStep: number;
  readonly snapshotRowDeleteBatchRows: number;
  readonly lagTransactions: number;
  readonly minimumRebuildMillis: number;
};

export const MAINTENANCE_POLICY = {
  cronExpression: "*/5 * * * *",
  budgetMillis: 5_000,
  organizationsPerRun: 100,
  partRows: SNAPSHOT_POLICY.partRows,
  minimumRetainedTransactions: 10_000,
  deleteBatchTransactions: 500,
  deleteBatchesPerStep: 4,
  expiredLeaseBatchRows: 200,
  expiredTicketBatchRows: 500,
  retainedPublishedSnapshots: 2,
  prunedSnapshotsPerStep: 5,
  snapshotRowDeleteBatchRows: 500,
  lagTransactions: SNAPSHOT_POLICY.lagTransactions,
  minimumRebuildMillis: SNAPSHOT_POLICY.minimumRebuildMillis,
} as const satisfies MaintenancePolicy & { readonly cronExpression: string };

const OrganizationMaintenance = Schema.Struct({
  organizationId: Schema.String,
  floorBefore: Schema.String,
  floorAfter: Schema.String,
  deletedTransactions: Schema.Number,
  expiredLeases: Schema.Number,
  expiredTickets: Schema.Number,
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
  more: Schema.Boolean,
  elapsedMillis: Schema.Number,
});
export type MaintenanceSummary = typeof MaintenanceSummary.Type;

const MaintainRow = Schema.Struct({ summary: Schema.fromJsonString(MaintenanceSummary) });

const decodeMaintainRows = Schema.decodeUnknownEffect(Schema.Array(MaintainRow));

const PolicyJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Number));

const encodePolicy = Schema.encodeSync(PolicyJson);

const policyJson = (policy: MaintenancePolicy): string =>
  encodePolicy({
    budgetMillis: policy.budgetMillis,
    organizationsPerRun: policy.organizationsPerRun,
    partRows: policy.partRows,
    minimumRetainedTransactions: policy.minimumRetainedTransactions,
    deleteBatchTransactions: policy.deleteBatchTransactions,
    deleteBatchesPerStep: policy.deleteBatchesPerStep,
    expiredLeaseBatchRows: policy.expiredLeaseBatchRows,
    expiredTicketBatchRows: policy.expiredTicketBatchRows,
    retainedPublishedSnapshots: policy.retainedPublishedSnapshots,
    prunedSnapshotsPerStep: policy.prunedSnapshotsPerStep,
    snapshotRowDeleteBatchRows: policy.snapshotRowDeleteBatchRows,
    lagTransactions: policy.lagTransactions,
    minimumRebuildMillis: policy.minimumRebuildMillis,
  });

interface InventoryMaintenanceContract {
  readonly runScheduled: (
    policy?: Partial<MaintenancePolicy>,
  ) => Effect.Effect<MaintenanceSummary, InventoryError>;
}

export class InventoryMaintenance extends Context.Service<
  InventoryMaintenance,
  InventoryMaintenanceContract
>()("@store/server/InventoryMaintenance") {}

export const makeInventoryMaintenance = (
  db: InventoryDrizzle,
  defaults: MaintenancePolicy = MAINTENANCE_POLICY,
): InventoryMaintenanceContract =>
  InventoryMaintenance.of({
    runScheduled: Effect.fn("InventoryMaintenance.runScheduled")(function* (overrides) {
      const now = yield* Clock.currentTimeMillis;
      const policy = policyJson({ ...defaults, ...overrides });
      const raw = yield* runStatement(
        db.execute(
          sql`select "sync"."maintain"(${policy}::jsonb, ${now}::bigint)::text as "summary"`,
          "objects",
        ),
      );
      const [row] = yield* decodeMaintainRows(raw).pipe(Effect.mapError(databaseError));
      if (row === undefined) {
        return yield* Effect.fail(databaseError(new Error("Maintenance returned no summary.")));
      }
      if (row.summary.failures.length > 0) {
        yield* Effect.logWarning("inventory maintenance failures", row.summary.failures);
      }
      return row.summary;
    }),
  });

export const InventoryMaintenanceUnavailable = Layer.succeed(
  InventoryMaintenance,
  InventoryMaintenance.of({
    runScheduled: () => Effect.fail(inventoryPostgresUnavailable),
  }),
);
