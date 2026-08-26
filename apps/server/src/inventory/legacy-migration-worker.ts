import {
  chunkLegacyMigrationRows,
  type LegacyCatalogMigrationCommand,
  type LegacyCatalogMigrationJobStatus,
  type LegacyCatalogMigrationPhase,
  type LegacyCatalogMigrationResult,
  type LegacyCatalogMigrationStart,
  type LegacyCatalogReconciliationCommand,
  type LegacyCatalogReconciliationResult,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { InventoryDatabaseError, InventoryProtocolError } from "../inventory/errors";
import type { InventoryActor } from "../inventory/model";

export const LEGACY_MIGRATION_QUEUE_MAX_ATTEMPTS = 3;
/** Neon writes are cheap per chunk; finishing a large catalog in one Worker blows the CPU budget (1102). */
export const LEGACY_MIGRATION_BATCHES_PER_INVOCATION = 15;

export const LegacyMigrationQueueMessage = Schema.Struct({
  jobId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  organizationId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
});
export type LegacyMigrationQueueMessage = typeof LegacyMigrationQueueMessage.Type;

export class LegacyMigrationJobProcessingError extends Schema.TaggedError<LegacyMigrationJobProcessingError>()(
  "LegacyMigrationJobProcessingError",
  {
    jobId: Schema.String,
    message: Schema.String,
  },
) {}

export class LegacyMigrationQueueError extends Schema.TaggedError<LegacyMigrationQueueError>()(
  "LegacyMigrationQueueError",
  {
    message: Schema.String,
  },
) {}

export type LegacyMigrationJobClaim =
  | {
      readonly kind: "process";
      readonly actor: InventoryActor;
      readonly request: LegacyCatalogMigrationStart;
      readonly processedRows: number;
      readonly importedRows: number;
      readonly skippedRows: number;
    }
  | { readonly kind: "skip" }
  | { readonly kind: "missing" };

export type LegacyMigrationJobOutcome = { readonly kind: "done" } | { readonly kind: "continue" };

export interface LegacyMigrationProgressUpdate {
  readonly jobId: string;
  readonly organizationId: string;
  readonly phase: LegacyCatalogMigrationPhase;
  readonly processedRows: number;
  readonly importedRows: number;
  readonly skippedRows: number;
  readonly progress: number;
}

export interface LegacyMigrationJobStore {
  readonly claim: (input: {
    readonly message: LegacyMigrationQueueMessage;
    readonly deliveryAttempt: number;
  }) => Effect.Effect<LegacyMigrationJobClaim, InventoryDatabaseError>;
  readonly migrateBatch: (
    actor: InventoryActor,
    command: LegacyCatalogMigrationCommand,
  ) => Effect.Effect<LegacyCatalogMigrationResult, InventoryDatabaseError | InventoryProtocolError>;
  readonly reconcile: (
    actor: InventoryActor,
    command: LegacyCatalogReconciliationCommand,
  ) => Effect.Effect<
    LegacyCatalogReconciliationResult,
    InventoryDatabaseError | InventoryProtocolError
  >;
  readonly updateProgress: (
    input: LegacyMigrationProgressUpdate,
  ) => Effect.Effect<void, InventoryDatabaseError>;
  readonly succeed: (
    input: Omit<LegacyMigrationProgressUpdate, "phase" | "progress">,
  ) => Effect.Effect<void, InventoryDatabaseError>;
  readonly fail: (input: {
    readonly jobId: string;
    readonly organizationId: string;
    readonly error: string;
  }) => Effect.Effect<void, InventoryDatabaseError>;
}

interface UploadUnit {
  readonly command: LegacyCatalogMigrationCommand;
}

export const legacyMigrationUploadPlan = (
  request: LegacyCatalogMigrationStart,
  jobId: string,
): ReadonlyArray<UploadUnit> => [
  ...chunkLegacyMigrationRows(request.catalog.categories).map((rows, index): UploadUnit => ({
    command: {
      kind: "categories",
      commandId: `${jobId}:categories:${index}`,
      deviceId: request.deviceId,
      occurredAt: request.occurredAt,
      rows,
    },
  })),
  ...chunkLegacyMigrationRows(request.catalog.products).map((rows, index): UploadUnit => ({
    command: {
      kind: "products",
      commandId: `${jobId}:products:${index}`,
      deviceId: request.deviceId,
      occurredAt: request.occurredAt,
      rows,
    },
  })),
  ...chunkLegacyMigrationRows(request.catalog.batches).map((rows, index): UploadUnit => ({
    command: {
      kind: "batches",
      commandId: `${jobId}:batches:${index}`,
      deviceId: request.deviceId,
      occurredAt: request.occurredAt,
      rows,
    },
  })),
  ...chunkLegacyMigrationRows(request.catalog.invoices).map((rows, index): UploadUnit => ({
    command: {
      kind: "invoices",
      commandId: `${jobId}:invoices:${index}`,
      deviceId: request.deviceId,
      occurredAt: request.occurredAt,
      rows,
    },
  })),
  ...chunkLegacyMigrationRows(request.catalog.invoiceItems).map((rows, index): UploadUnit => ({
    command: {
      kind: "invoice-items",
      commandId: `${jobId}:invoice-items:${index}`,
      deviceId: request.deviceId,
      occurredAt: request.occurredAt,
      rows,
    },
  })),
  ...chunkLegacyMigrationRows(request.catalog.stockMovements).map((rows, index): UploadUnit => ({
    command: {
      kind: "stock-movements",
      commandId: `${jobId}:stock-movements:${index}`,
      deviceId: request.deviceId,
      occurredAt: request.occurredAt,
      rows,
    },
  })),
];

const reconciliationFor = (
  request: LegacyCatalogMigrationStart,
): LegacyCatalogReconciliationCommand => ({
  deviceId: request.deviceId,
  occurredAt: request.occurredAt,
  categoryIds: request.catalog.categories.map((row) => row.id),
  productIds: request.catalog.products.map((row) => row.id),
  batchIds: request.catalog.batches.map((row) => row.id),
  invoiceIds: request.catalog.invoices.map((row) => row.id),
  invoiceItemIds: request.catalog.invoiceItems.map((row) => row.id),
  stockMovementIds: request.catalog.stockMovements.map((row) => row.id),
});

const migrationProgress = (processedRows: number, totalRows: number) =>
  totalRows === 0 ? 0 : Math.min(99, Math.floor((processedRows / totalRows) * 100));

const totalRowsIn = (request: LegacyCatalogMigrationStart) =>
  request.catalog.categories.length +
  request.catalog.products.length +
  request.catalog.batches.length +
  request.catalog.invoices.length +
  request.catalog.invoiceItems.length +
  request.catalog.stockMovements.length;

export const processLegacyMigrationJob = Effect.fn("LegacyMigrationJob.process")(function* (
  store: LegacyMigrationJobStore,
  message: LegacyMigrationQueueMessage,
  deliveryAttempt: number,
  batchesPerInvocation: number = LEGACY_MIGRATION_BATCHES_PER_INVOCATION,
) {
  const claim = yield* store.claim({ message, deliveryAttempt });
  if (claim.kind === "skip") return { kind: "done" } as const;
  if (claim.kind === "missing") {
    return yield* Effect.fail(
      LegacyMigrationJobProcessingError.make({
        jobId: message.jobId,
        message: "The queued migration job no longer exists.",
      }),
    );
  }

  const plan = legacyMigrationUploadPlan(claim.request, message.jobId);
  const totalRows = totalRowsIn(claim.request);
  let processedRows = claim.processedRows;
  let importedRows = claim.importedRows;
  let skippedRows = claim.skippedRows;
  let plannedRows = 0;
  let batchesThisInvocation = 0;

  const firstPending = plan.find((unit) => {
    plannedRows += unit.command.rows.length;
    return plannedRows > processedRows;
  });
  yield* store.updateProgress({
    jobId: message.jobId,
    organizationId: message.organizationId,
    phase: firstPending?.command.kind ?? "reconcile",
    processedRows,
    importedRows,
    skippedRows,
    progress: migrationProgress(processedRows, totalRows),
  });

  plannedRows = 0;
  for (const unit of plan) {
    plannedRows += unit.command.rows.length;
    if (plannedRows <= processedRows) continue;
    if (batchesThisInvocation >= batchesPerInvocation) {
      return { kind: "continue" } as const;
    }

    const result = yield* store.migrateBatch(claim.actor, unit.command);
    if (result.imported + result.skipped !== unit.command.rows.length) {
      return yield* Effect.fail(
        LegacyMigrationJobProcessingError.make({
          jobId: message.jobId,
          message: `Neon acknowledged only part of the ${unit.command.kind} batch.`,
        }),
      );
    }
    processedRows = plannedRows;
    importedRows += result.imported;
    skippedRows += result.skipped;
    batchesThisInvocation += 1;
    yield* store.updateProgress({
      jobId: message.jobId,
      organizationId: message.organizationId,
      phase: unit.command.kind,
      processedRows,
      importedRows,
      skippedRows,
      progress: migrationProgress(processedRows, totalRows),
    });
  }

  yield* store.updateProgress({
    jobId: message.jobId,
    organizationId: message.organizationId,
    phase: "reconcile",
    processedRows,
    importedRows,
    skippedRows,
    progress: 99,
  });
  yield* store.reconcile(claim.actor, reconciliationFor(claim.request));
  yield* store.succeed({
    jobId: message.jobId,
    organizationId: message.organizationId,
    processedRows,
    importedRows,
    skippedRows,
  });
  return { kind: "done" } as const;
});

export const terminalMigrationFailure =
  (store: LegacyMigrationJobStore, message: LegacyMigrationQueueMessage) =>
  (cause: unknown): Effect.Effect<void, InventoryDatabaseError> =>
    store.fail({
      jobId: message.jobId,
      organizationId: message.organizationId,
      error:
        cause instanceof LegacyMigrationJobProcessingError
          ? cause.message
          : "Migration failed after several attempts. Reopen the app to try again.",
    });

export const queuedMigrationStatus = (
  jobId: string,
  totalRows: number,
): LegacyCatalogMigrationJobStatus => ({
  status: "queued",
  phase: "queued",
  jobId,
  processedRows: 0,
  totalRows,
  importedRows: 0,
  skippedRows: 0,
  progress: 0,
});
