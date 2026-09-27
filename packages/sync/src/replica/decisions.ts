import {
  compareDecimalSequence,
  incrementDecimalSequence,
  rowImageDigest,
  subscriptionEntities,
  SyncCommandEnvelope,
  syncEntityDependencyOrder,
  syncProtocolError,
  type CommandReceipt,
  type PartitionDigest,
  type PartitionEntity,
  type SnapshotRow,
  type SyncEntity,
  type SyncProtocolError,
  type SyncSubscription,
} from "@store/contracts";
import type { CommandStatus } from "@store/contracts/sync/replica-model";
import * as Order from "effect/Order";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

const envelopesEqual = Schema.toEquivalence(SyncCommandEnvelope);

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

type ReplicaIdentitySnapshot = {
  readonly organizationId: string;
  readonly epoch: string;
  readonly replicaId: string;
  readonly nextClientSequence: string;
};

type EnqueueDecision =
  | {
      readonly _tag: "accepted";
      readonly status: "pending";
      readonly overlays: ReadonlyArray<StockOverlayDelta>;
      readonly nextClientSequence: string;
    }
  | {
      readonly _tag: "replay";
      readonly status: CommandStatus;
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

export const SYNC_ENTITIES: ReadonlyArray<SyncEntity> = [
  "category",
  "product",
  "batch",
  "invoice",
  "invoiceItem",
  "stockMovement",
];

export const byEntityDependency: Order.Order<{ readonly entity: SyncEntity }> = Order.mapInput(
  Order.Number,
  (row) => syncEntityDependencyOrder[row.entity],
);

export const byClientSequence: Order.Order<{ readonly clientSequence: string }> = Order.mapInput(
  compareDecimalSequence,
  (row) => row.clientSequence,
);

export const withOverlays = (
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

const overlayDeltasForInvoice = (
  operationId: string,
  allocations: ReadonlyArray<AllocationTake>,
  unitsPerPackFor: (productId: string) => number,
  stockFor: (batchId: string) => VisibleStock,
): ReadonlyArray<StockOverlayDelta> => {
  const overlays: Array<StockOverlayDelta> = [];
  const working = new Map<string, VisibleStock>();
  for (const take of allocations) {
    const unitsPerPack = unitsPerPackFor(take.productId);
    const current = working.get(take.batchId) ?? stockFor(take.batchId);
    const packDeltaRaw = take.quantityType === "pack" ? -take.quantity : -take.packsOpened;
    const unitDeltaRaw =
      take.quantityType === "pack" ? 0 : take.packsOpened * unitsPerPack - take.quantity;
    const packDelta = Object.is(packDeltaRaw, -0) ? 0 : packDeltaRaw;
    const unitDelta = Object.is(unitDeltaRaw, -0) ? 0 : unitDeltaRaw;
    working.set(take.batchId, withOverlays(current, [{ packDelta, unitDelta }]));
    overlays.push({ commandId: operationId, batchId: take.batchId, packDelta, unitDelta });
  }
  return overlays;
};

export const decideOverlays = (
  envelope: SyncCommandEnvelope,
  unitsPerPackFor: (productId: string) => number,
  stockFor: (batchId: string) => VisibleStock,
): ReadonlyArray<StockOverlayDelta> => {
  if (envelope.command._tag !== "issueInvoice") return [];
  return overlayDeltasForInvoice(
    envelope.operationId,
    envelope.command.payload.allocations,
    unitsPerPackFor,
    stockFor,
  );
};

export const decideEnqueue = (
  identity: ReplicaIdentitySnapshot,
  existing:
    | {
        readonly status: CommandStatus;
        readonly envelope: SyncCommandEnvelope;
      }
    | undefined,
  envelope: SyncCommandEnvelope,
  unitsPerPackFor: (productId: string) => number,
  stockFor: (batchId: string) => VisibleStock,
): Result.Result<EnqueueDecision, SyncProtocolError> => {
  if (existing) {
    return envelopesEqual(existing.envelope, envelope)
      ? Result.succeed({ _tag: "replay", status: existing.status })
      : Result.fail(syncProtocolError("OPERATION_ID_REUSED", "The local command id was reused."));
  }
  if (envelope.organizationId !== identity.organizationId) {
    return Result.fail(
      syncProtocolError(
        "ORGANIZATION_MISMATCH",
        "The local command belongs to another organization.",
      ),
    );
  }
  if (envelope.epoch !== identity.epoch) {
    return Result.fail(
      syncProtocolError("EPOCH_MISMATCH", "The local command uses another epoch."),
    );
  }
  if (envelope.replicaId !== identity.replicaId) {
    return Result.fail(
      syncProtocolError(
        "COMMAND_IDENTITY_MISMATCH",
        "The local command belongs to another replica.",
      ),
    );
  }
  if (envelope.clientSequence !== identity.nextClientSequence) {
    return Result.fail(
      syncProtocolError(
        "REPLICA_SEQUENCE_GAP",
        `Expected replica sequence ${identity.nextClientSequence}, received ${envelope.clientSequence}.`,
      ),
    );
  }
  return Result.succeed({
    _tag: "accepted",
    status: "pending",
    overlays: decideOverlays(envelope, unitsPerPackFor, stockFor),
    nextClientSequence: incrementDecimalSequence(identity.nextClientSequence),
  });
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
  if (status === "abandoned") return Result.succeed({ _tag: "noop", status });
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

export const nextUploadClaim = <Row>(pendingInSequence: ReadonlyArray<Row>): Row | undefined =>
  pendingInSequence[0];

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

export const checkAuthorityHead = (
  appliedCommitSequence: string,
  authorityHorizon: string,
): Result.Result<void, SyncProtocolError> =>
  compareDecimalSequence(appliedCommitSequence, authorityHorizon) > 0
    ? Result.fail(
        syncProtocolError(
          "SNAPSHOT_REQUIRED",
          `Local applied cursor ${appliedCommitSequence} is ahead of authority horizon ${authorityHorizon}.`,
        ),
      )
    : Result.void;

export type CoverageAfterPull<Digest extends string> =
  | { readonly _tag: "unchanged" }
  | { readonly _tag: "repair" }
  | { readonly _tag: "record"; readonly digest: Digest; readonly verified: boolean };

export const decideCoverageAfterPull = <Digest extends string>(
  localDigest: string | undefined,
  pulledDigest: Digest | undefined,
): CoverageAfterPull<Digest> => {
  if (pulledDigest === undefined || pulledDigest === "") return { _tag: "unchanged" };
  if (localDigest === undefined) return { _tag: "record", digest: pulledDigest, verified: false };
  if (localDigest !== pulledDigest) return { _tag: "repair" };
  return { _tag: "record", digest: pulledDigest, verified: true };
};

export type PartitionRowSource = {
  readonly entity: PartitionEntity;
  readonly row: { readonly id: string; readonly rowVersion: number };
};

const AUTHORITY_SOFT_DELETE_ENTITIES: ReadonlySet<PartitionEntity> = new Set<PartitionEntity>([
  "product",
  "batch",
]);

export const authorityRowImage = (source: PartitionRowSource): SnapshotRow => ({
  entity: source.entity,
  entityId: source.row.id,
  rowVersion: source.row.rowVersion,
  row: AUTHORITY_SOFT_DELETE_ENTITIES.has(source.entity)
    ? { ...source.row, deletedAt: null }
    : source.row,
});

export const isPartitionEntity = (
  subscription: SyncSubscription,
  entity: SyncEntity,
): entity is PartitionEntity =>
  subscriptionEntities(subscription).some((candidate) => candidate === entity);

export const localPartitionDigest = (
  subscription: SyncSubscription,
  rows: ReadonlyArray<PartitionRowSource>,
  pendingMarks: ReadonlyArray<{ readonly entity: SyncEntity }>,
): PartitionDigest | undefined =>
  pendingMarks.some((mark) => isPartitionEntity(subscription, mark.entity))
    ? undefined
    : rowImageDigest(
        rows
          .filter((source) => isPartitionEntity(subscription, source.entity))
          .map(authorityRowImage),
      );

export type JournalHolder = {
  readonly operationId: string;
  readonly clientSequence: string;
};

export type JournalRestoreDecision =
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

export const freeCategoryName = (name: string, taken: ReadonlySet<string>): string => {
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${name} (${suffix})`;
    if (!taken.has(candidate)) return candidate;
  }
};
