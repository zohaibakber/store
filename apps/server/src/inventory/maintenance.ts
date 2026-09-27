import { inventoryState } from "@store/db/postgres/schema";
import { asc, eq, sql } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type { InventoryError } from "./errors";
import { inventoryPostgresUnavailable, runTransaction, type InventoryDrizzle } from "./postgres";
import { runRetentionStep, type RetentionProgress } from "./retention";
import {
  ensureSnapshotJob,
  SNAPSHOT_REFRESH_POLICY,
  stepSnapshotJobs,
  type SnapshotRefreshPolicy,
  type SnapshotStepProgress,
} from "./snapshots";

export const MAINTENANCE_POLICY = {
  cronExpression: "*/5 * * * *",
  budgetMillis: 20_000,
  organizationsPerRun: 100,
  snapshotStepsPerOrganization: 64,
} as const;

export type MaintenanceProgress = {
  readonly organizations: number;
  readonly enqueuedSnapshots: number;
  readonly retention: ReadonlyArray<RetentionProgress>;
  readonly snapshots: ReadonlyArray<SnapshotStepProgress>;
  readonly more: boolean;
};

export interface InventoryMaintenanceContract {
  readonly runScheduled: (
    budgetMillis?: number,
  ) => Effect.Effect<MaintenanceProgress, InventoryError>;
}

export class InventoryMaintenance extends Context.Service<
  InventoryMaintenance,
  InventoryMaintenanceContract
>()("@store/server/InventoryMaintenance") {}

export const makeInventoryMaintenance = (
  db: InventoryDrizzle,
  refresh: SnapshotRefreshPolicy = SNAPSHOT_REFRESH_POLICY,
  organizationsPerRun: number = MAINTENANCE_POLICY.organizationsPerRun,
): InventoryMaintenanceContract => {
  const transact = runTransaction(db);
  const retentionStep = runRetentionStep(db);
  const ensureJob = ensureSnapshotJob(db, refresh);
  const snapshotStep = stepSnapshotJobs(db);
  return InventoryMaintenance.of({
    runScheduled: Effect.fn("InventoryMaintenance.runScheduled")(function* (budgetMillis) {
      const budget = budgetMillis ?? MAINTENANCE_POLICY.budgetMillis;
      const startedAt = yield* Clock.currentTimeMillis;
      const organizations = yield* transact("repeatable read", "read only", (tx) =>
        tx
          .select({ organizationId: inventoryState.organizationId })
          .from(inventoryState)
          .where(eq(inventoryState.status, "ready"))
          .orderBy(
            sql`${inventoryState.maintainedAt} asc nulls first`,
            asc(inventoryState.organizationId),
          )
          .limit(organizationsPerRun),
      );

      const retention: Array<RetentionProgress> = [];
      const snapshots: Array<SnapshotStepProgress> = [];
      let processed = 0;
      let enqueuedSnapshots = 0;
      let more = false;

      for (const { organizationId } of organizations) {
        const now = yield* Clock.currentTimeMillis;
        if (now - startedAt >= budget) {
          more = true;
          break;
        }
        const attempt = <A>(failure: string, step: Effect.Effect<A, InventoryError>) =>
          step.pipe(
            Effect.tapError((error) => Effect.logError(failure, { organizationId, error })),
            Effect.option,
          );
        const retained = yield* attempt(
          "inventory retention step failed",
          retentionStep(organizationId, now),
        );
        if (Option.isSome(retained)) {
          retention.push(retained.value);
          if (retained.value.more) more = true;
          yield* Effect.log("inventory retention step", retained.value);
        }
        const ensured = yield* attempt(
          "inventory snapshot enqueue failed",
          ensureJob(organizationId),
        );
        if (Option.isSome(ensured) && ensured.value !== undefined) {
          enqueuedSnapshots += 1;
          more = true;
          yield* Effect.log("inventory snapshot job enqueued", {
            organizationId,
            snapshotId: ensured.value,
          });
        }
        for (let step = 0; step < MAINTENANCE_POLICY.snapshotStepsPerOrganization; step += 1) {
          const stepped = yield* attempt(
            "inventory snapshot step failed",
            snapshotStep(organizationId),
          );
          if (Option.isNone(stepped)) break;
          snapshots.push(stepped.value);
          yield* Effect.log("inventory snapshot step", stepped.value);
          if (!stepped.value.advanced || stepped.value.stage === "published") break;
          const steppedAt = yield* Clock.currentTimeMillis;
          if (
            steppedAt - startedAt >= budget ||
            step + 1 === MAINTENANCE_POLICY.snapshotStepsPerOrganization
          ) {
            more = true;
            break;
          }
        }
        const maintainedAt = yield* Clock.currentTimeMillis;
        yield* attempt(
          "inventory maintenance stamp failed",
          transact("read committed", "read write", (tx) =>
            tx
              .update(inventoryState)
              .set({ maintainedAt })
              .where(eq(inventoryState.organizationId, organizationId)),
          ),
        );
        processed += 1;
      }

      if (organizations.length === organizationsPerRun) more = true;

      return {
        organizations: processed,
        enqueuedSnapshots,
        retention,
        snapshots,
        more,
      } satisfies MaintenanceProgress;
    }),
  });
};

export const InventoryMaintenanceUnavailable = Layer.succeed(
  InventoryMaintenance,
  InventoryMaintenance.of({
    runScheduled: () => Effect.fail(inventoryPostgresUnavailable),
  }),
);
