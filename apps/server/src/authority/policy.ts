import {
  MAX_IMPORT_PART_BYTES,
  MAX_IMPORT_PART_ROWS,
  MAX_IMPORT_PARTS,
  MAX_SNAPSHOT_PART_BYTES,
  MAX_SNAPSHOT_PART_ROWS,
  MAX_SYNC_PULL_TRANSACTIONS,
  MAX_TRANSPORT_PAYLOAD_BYTES,
  MIN_PULL_BYTE_BUDGET,
  SNAPSHOT_LEASE_LIFETIME_MILLIS,
} from "@store/contracts";
import * as Number from "effect/Number";

import type { ImportLimits } from "./imports";
import type { MaintenancePolicy } from "./maintenance";
import type { SnapshotPolicy } from "./snapshots";

const PULL_ENVELOPE_HEADROOM_BYTES = 16_384;

export const PULL_PAYLOAD_BUDGET_BYTES = MAX_TRANSPORT_PAYLOAD_BYTES - PULL_ENVELOPE_HEADROOM_BYTES;

const clampPullByteBudget = Number.clamp({
  minimum: MIN_PULL_BYTE_BUDGET,
  maximum: PULL_PAYLOAD_BUDGET_BYTES,
});

export const pullByteBudget = (maxBytes: number | undefined): number =>
  maxBytes === undefined ? PULL_PAYLOAD_BUDGET_BYTES : clampPullByteBudget(maxBytes);

export const PULL_MAX_GROUPS = MAX_SYNC_PULL_TRANSACTIONS;

export const SNAPSHOT_POLICY = {
  partRows: MAX_SNAPSHOT_PART_ROWS,
  partBytes: MAX_SNAPSHOT_PART_BYTES,
  leaseMillis: SNAPSHOT_LEASE_LIFETIME_MILLIS,
  lagTransactions: 100,
  minimumRebuildMillis: 15 * 60_000,
} as const satisfies SnapshotPolicy;

export const MAINTENANCE_POLICY = {
  ...SNAPSHOT_POLICY,
  budgetMillis: 5_000,
  minimumRetainedTransactions: 10_000,
  deleteBatchTransactions: 500,
  deleteBatchesPerStep: 4,
  expiredLeaseBatchRows: 200,
  retainedPublishedSnapshots: 2,
  prunedSnapshotsPerStep: 5,
  snapshotRowDeleteBatchRows: 500,
  abandonedImportMillis: 24 * 60 * 60_000,
  abandonedImportBatchParts: 64,
} as const satisfies MaintenancePolicy;

export const MAINTENANCE_INTERVAL_MILLIS = 5 * 60_000;

export const MAINTENANCE_CONTINUE_MILLIS = 1_000;

export const IMPORT_LIMITS = {
  maxBytes: MAX_IMPORT_PART_BYTES,
  maxRows: MAX_IMPORT_PART_ROWS,
  maxParts: MAX_IMPORT_PARTS,
} as const satisfies ImportLimits;
