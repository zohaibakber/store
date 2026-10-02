import {
  compareDecimalSequence,
  divergedPartitionEntities,
  syncProtocolError,
  type CommandReceipt,
  type PartitionDigest,
  type PartitionDigestReport,
  type PartitionEntity,
  type SnapshotManifest,
  type SnapshotPartPayload,
  type SyncCommand,
  SyncEntity,
  type SyncCommandEnvelope,
  type SyncProtocolError,
} from "@store/contracts";
import type { CommandStatus } from "@store/contracts/sync/replica-model";
import * as Order from "effect/Order";
import * as Result from "effect/Result";

export type VisibleStock = {
  readonly packQuantity: number;
  readonly unitQuantity: number;
};

export type StockOverlayDelta = {
  readonly commandId: string;
  readonly batchId: string;
  readonly packDelta: number;
  readonly unitDelta: number;
};

type AllocationTake = {
  readonly productId: string;
  readonly batchId: string;
  readonly quantity: number;
  readonly quantityType: "unit" | "pack";
  readonly packsOpened: number;
};

export const OUTSTANDING_COMMAND_STATUSES: ReadonlyArray<CommandStatus> = [
  "pending",
  "sending",
  "accepted_awaiting_integration",
];

export const SYNC_ENTITIES: ReadonlyArray<SyncEntity> = SyncEntity.literals;

const syncEntityDependencyOrder = {
  category: 0,
  supplier: 0,
  product: 1,
  purchaseOrder: 1,
  batch: 2,
  invoice: 2,
  purchaseOrderItem: 2,
  invoiceItem: 3,
  stockMovement: 4,
} as const satisfies Record<SyncEntity, number>;

export const byEntityDependency: Order.Order<{ readonly entity: SyncEntity }> = Order.mapInput(
  Order.Number,
  (row) => syncEntityDependencyOrder[row.entity],
);

export const byClientSequence: Order.Order<{ readonly clientSequence: string }> = Order.mapInput(
  compareDecimalSequence,
  (row) => row.clientSequence,
);

const withOverlays = (
  base: VisibleStock,
  overlays: ReadonlyArray<{ readonly packDelta: number; readonly unitDelta: number }>,
): VisibleStock =>
  overlays.reduce(
    (stock, overlay) => ({
      packQuantity: stock.packQuantity + overlay.packDelta,
      unitQuantity: stock.unitQuantity + overlay.unitDelta,
    }),
    { packQuantity: base.packQuantity, unitQuantity: base.unitQuantity },
  );

export const EMPTY_STOCK: VisibleStock = { packQuantity: 0, unitQuantity: 0 };

export type SequencedOverlay = {
  readonly packDelta: number;
  readonly unitDelta: number;
  readonly clientSequence: string | undefined;
};

export const withPendingOverlays = (
  base: VisibleStock,
  overlays: ReadonlyArray<SequencedOverlay>,
  absoluteSequence: string | undefined,
): VisibleStock =>
  withOverlays(
    base,
    absoluteSequence === undefined
      ? overlays
      : overlays.filter(
          (overlay) =>
            overlay.clientSequence === undefined ||
            compareDecimalSequence(overlay.clientSequence, absoluteSequence) > 0,
        ),
  );

const overlayDeltasForInvoice = (
  operationId: string,
  allocations: ReadonlyArray<AllocationTake>,
  unitsPerPackFor: (productId: string) => number,
): ReadonlyArray<StockOverlayDelta> => {
  const byBatch = new Map<string, StockOverlayDelta>();
  for (const take of allocations) {
    const unitsPerPack = unitsPerPackFor(take.productId);
    const held = byBatch.get(take.batchId);
    byBatch.set(take.batchId, {
      commandId: operationId,
      batchId: take.batchId,
      packDelta:
        (held?.packDelta ?? 0) - (take.quantityType === "pack" ? take.quantity : take.packsOpened),
      unitDelta:
        (held?.unitDelta ?? 0) +
        (take.quantityType === "pack" ? 0 : take.packsOpened * unitsPerPack - take.quantity),
    });
  }
  return [...byBatch.values()];
};

export const decideOverlays = (
  command: { readonly operationId: string; readonly command: SyncCommand },
  unitsPerPackFor: (productId: string) => number,
): ReadonlyArray<StockOverlayDelta> => {
  if (command.command._tag !== "issueInvoice") return [];
  return overlayDeltasForInvoice(
    command.operationId,
    command.command.payload.allocations,
    unitsPerPackFor,
  );
};

export const decideEnqueueReplay = (
  existing:
    | {
        readonly status: CommandStatus;
        readonly envelope: Pick<SyncCommandEnvelope, "payloadHash">;
      }
    | undefined,
  payloadHash: string,
): Result.Result<CommandStatus | undefined, SyncProtocolError> => {
  if (existing === undefined) return Result.succeed(undefined);
  return existing.envelope.payloadHash === payloadHash
    ? Result.succeed(existing.status)
    : Result.fail(syncProtocolError("OPERATION_ID_REUSED", "The local command id was reused."));
};

export const checkStoredEnvelope = (
  row: { readonly operationId: string; readonly clientSequence: string },
  envelope: SyncCommandEnvelope,
): Result.Result<SyncCommandEnvelope, SyncProtocolError> =>
  envelope.operationId === row.operationId && envelope.clientSequence === row.clientSequence
    ? Result.succeed(envelope)
    : Result.fail(
        syncProtocolError(
          "COMMAND_IDENTITY_MISMATCH",
          "The stored command identity does not match its outbox row.",
        ),
      );

type ReceiptDecision =
  | { readonly _tag: "noop"; readonly status: CommandStatus }
  | { readonly _tag: "rejected"; readonly status: "rejected" }
  | { readonly _tag: "accepted"; readonly status: "accepted_awaiting_integration" }
  | { readonly _tag: "refreshIntegrated"; readonly status: "integrated" };

const receiptMatches = (envelope: SyncCommandEnvelope, receipt: CommandReceipt): boolean =>
  receipt.operationId === envelope.operationId &&
  receipt.replicaId === envelope.replicaId &&
  receipt.clientSequence === envelope.clientSequence &&
  receipt.payloadHash === envelope.payloadHash;

export const decideReceipt = (
  status: CommandStatus,
  envelope: SyncCommandEnvelope,
  receipt: CommandReceipt,
  claimMatches: boolean,
): Result.Result<ReceiptDecision, SyncProtocolError> => {
  if (!claimMatches) return Result.succeed({ _tag: "noop", status });
  if (!receiptMatches(envelope, receipt)) {
    return Result.fail(
      syncProtocolError(
        "COMMAND_IDENTITY_MISMATCH",
        "The command receipt does not match the stored command.",
      ),
    );
  }
  if (status === "integrated") {
    return receipt.decision === "accepted"
      ? Result.succeed({ _tag: "refreshIntegrated", status: "integrated" })
      : Result.fail(
          syncProtocolError(
            "COMMAND_IDENTITY_MISMATCH",
            "An integrated command received a rejected receipt.",
          ),
        );
  }
  return Result.succeed(
    receipt.decision === "rejected"
      ? { _tag: "rejected", status: "rejected" }
      : { _tag: "accepted", status: "accepted_awaiting_integration" },
  );
};

export const settledOutboxFields = (receipt: CommandReceipt, receiptJson: string) => ({
  receiptJson,
  commitSequence: receipt.commitSequence,
  claimId: null,
  claimedAt: null,
  outcomeUncertain: false,
});

const AWAITING_SNAPSHOT_FIELDS = {
  state: "awaiting_snapshot",
  throughCommitSequence: null,
  digest: null,
  verifiedAt: null,
} as const;

export const awaitingSnapshotCoverage = (subscription: string) => ({
  subscription,
  ...AWAITING_SNAPSHOT_FIELDS,
});

export const RELEASED_CLAIM_FIELDS = {
  status: "pending",
  claimId: null,
  claimedAt: null,
  outcomeUncertain: true,
} as const;

export const isStaleClaim = (
  row: { readonly claimedAt: number | null },
  staleBefore: number,
): boolean => row.claimedAt === null || row.claimedAt <= staleBefore;

export const shouldApplyCommitSequence = (
  appliedCommitSequence: string,
  commitSequence: string,
): boolean => compareDecimalSequence(commitSequence, appliedCommitSequence) > 0;

export const checkIncarnation = (
  local: string,
  received: string,
): Result.Result<void, SyncProtocolError> =>
  local === received
    ? Result.void
    : Result.fail(
        syncProtocolError(
          "INCARNATION_MISMATCH",
          `Expected incarnation ${local}, received ${received}.`,
        ),
      );

type CoverageAfterPull =
  | { readonly _tag: "unchanged" }
  | { readonly _tag: "repair"; readonly diverged: ReadonlyArray<PartitionEntity> }
  | { readonly _tag: "record"; readonly digest: PartitionDigest; readonly verified: boolean };

export const decideCoverageAfterPull = (
  local: PartitionDigestReport | undefined,
  pulled: PartitionDigestReport | undefined,
): CoverageAfterPull => {
  if (pulled === undefined) return { _tag: "unchanged" };
  if (local === undefined) return { _tag: "record", digest: pulled.digest, verified: false };
  if (local.digest !== pulled.digest) {
    return { _tag: "repair", diverged: divergedPartitionEntities(local, pulled) };
  }
  return { _tag: "record", digest: pulled.digest, verified: true };
};

export type JournalHolder = {
  readonly operationId: string;
  readonly clientSequence: string;
};

type JournalRestoreDecision =
  | { readonly _tag: "restore"; readonly nextMark: string | undefined }
  | { readonly _tag: "handDown"; readonly successor: string }
  | { readonly _tag: "leave" };

export const decideJournalRestore = (
  rejected: JournalHolder,
  mark: string | undefined,
  others: ReadonlyArray<JournalHolder>,
): JournalRestoreDecision => {
  const ordered = [...others].sort(byClientSequence);
  if (mark === rejected.operationId) {
    const earlier = ordered.filter(
      (holder) => compareDecimalSequence(holder.clientSequence, rejected.clientSequence) < 0,
    );
    return { _tag: "restore", nextMark: earlier.at(-1)?.operationId };
  }
  if (mark === undefined) return { _tag: "leave" };
  const successor = ordered.find(
    (holder) => compareDecimalSequence(holder.clientSequence, rejected.clientSequence) > 0,
  );
  return successor ? { _tag: "handDown", successor: successor.operationId } : { _tag: "leave" };
};

export const freeDocumentNumber = (proposed: number, highestOtherNumber: number): number =>
  Math.max(highestOtherNumber, proposed) + 1;

type PartImportProgress = {
  readonly stage: string;
  readonly partsImported: number;
};

type PartAdmission<Row> = {
  readonly _tag: "imported" | "next";
  readonly importRow: Row;
};

const partRefused = (message: string) =>
  Result.fail(syncProtocolError("SNAPSHOT_UNAVAILABLE", message));

export const decidePartAdmission = <Row extends PartImportProgress>(
  importRow: Row | undefined,
  manifest: SnapshotManifest,
  part: Pick<SnapshotPartPayload, "snapshotId" | "partNumber">,
): Result.Result<PartAdmission<Row>, SyncProtocolError> => {
  if (!importRow || importRow.stage === "activated" || importRow.stage === "failed") {
    return partRefused("The snapshot import is not active.");
  }
  if (!manifest.parts.some((entry) => entry.partNumber === part.partNumber)) {
    return partRefused("The snapshot part is not in the manifest.");
  }
  if (part.snapshotId !== manifest.snapshotId) {
    return partRefused("The snapshot part identity does not match.");
  }
  if (part.partNumber <= importRow.partsImported) {
    return Result.succeed({ _tag: "imported", importRow });
  }
  if (part.partNumber !== importRow.partsImported + 1) {
    return partRefused("The snapshot part arrived out of order.");
  }
  return Result.succeed({ _tag: "next", importRow });
};
