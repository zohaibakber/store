import {
  compareDecimalSequence,
  incrementDecimalSequence,
  SyncCommandEnvelope,
  syncProtocolError,
  type CommandReceipt,
} from "@store/contracts";
import type { CommandStatus } from "@store/contracts/sync/replica-model";
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

export type ReplicaIdentitySnapshot = {
  readonly organizationId: string;
  readonly epoch: string;
  readonly replicaId: string;
  readonly nextClientSequence: string;
};

export type EnqueueAccepted = {
  readonly _tag: "accepted";
  readonly status: "pending";
  readonly overlays: ReadonlyArray<StockOverlayDelta>;
  readonly nextClientSequence: string;
};

export type EnqueueReplay = {
  readonly _tag: "replay";
  readonly status: CommandStatus;
};

export type EnqueueDecision = EnqueueAccepted | EnqueueReplay;

export type AllocationTake = {
  readonly productId: string;
  readonly batchId: string;
  readonly quantity: number;
  readonly quantityType: "unit" | "pack";
  readonly packsOpened: number;
};

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
    working.set(take.batchId, {
      packQuantity: current.packQuantity + packDelta,
      unitQuantity: current.unitQuantity + unitDelta,
    });
    overlays.push({
      commandId: operationId,
      batchId: take.batchId,
      packDelta,
      unitDelta,
    });
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
): EnqueueDecision => {
  if (existing) {
    if (!envelopesEqual(existing.envelope, envelope)) {
      throw syncProtocolError("OPERATION_ID_REUSED", "The local command id was reused.");
    }
    return { _tag: "replay", status: existing.status };
  }
  if (envelope.organizationId !== identity.organizationId) {
    throw syncProtocolError(
      "ORGANIZATION_MISMATCH",
      "The local command belongs to another organization.",
    );
  }
  if (envelope.epoch !== identity.epoch) {
    throw syncProtocolError("EPOCH_MISMATCH", "The local command uses another epoch.");
  }
  if (envelope.replicaId !== identity.replicaId) {
    throw syncProtocolError(
      "COMMAND_IDENTITY_MISMATCH",
      "The local command belongs to another replica.",
    );
  }
  if (envelope.clientSequence !== identity.nextClientSequence) {
    throw syncProtocolError(
      "REPLICA_SEQUENCE_GAP",
      `Expected replica sequence ${identity.nextClientSequence}, received ${envelope.clientSequence}.`,
    );
  }
  return {
    _tag: "accepted",
    status: "pending",
    overlays: decideOverlays(envelope, unitsPerPackFor, stockFor),
    nextClientSequence: incrementDecimalSequence(identity.nextClientSequence),
  };
};

export const validateReceipt = (envelope: SyncCommandEnvelope, receipt: CommandReceipt): void => {
  if (
    receipt.operationId !== envelope.operationId ||
    receipt.replicaId !== envelope.replicaId ||
    receipt.clientSequence !== envelope.clientSequence ||
    receipt.payloadHash !== envelope.payloadHash
  ) {
    throw syncProtocolError(
      "COMMAND_IDENTITY_MISMATCH",
      "The command receipt does not match the stored command.",
    );
  }
};

export type ReceiptDecision =
  | { readonly _tag: "noop"; readonly status: CommandStatus }
  | {
      readonly _tag: "rejected";
      readonly status: "rejected";
      readonly clearOverlays: true;
    }
  | {
      readonly _tag: "accepted";
      readonly status: "accepted_awaiting_integration";
    }
  | {
      readonly _tag: "refreshIntegrated";
      readonly status: "integrated";
    };

export const decideReceipt = (
  status: CommandStatus,
  envelope: SyncCommandEnvelope,
  receipt: CommandReceipt,
  claimMatches: boolean,
): ReceiptDecision => {
  if (!claimMatches) return { _tag: "noop", status };
  validateReceipt(envelope, receipt);
  if (status === "abandoned") return { _tag: "noop", status };
  if (status === "integrated") {
    if (receipt.decision !== "accepted") {
      throw syncProtocolError(
        "COMMAND_IDENTITY_MISMATCH",
        "An integrated command received a rejected receipt.",
      );
    }
    return { _tag: "refreshIntegrated", status: "integrated" };
  }
  if (receipt.decision === "rejected") {
    return { _tag: "rejected", status: "rejected", clearOverlays: true };
  }
  return { _tag: "accepted", status: "accepted_awaiting_integration" };
};

export const shouldApplyCommitSequence = (
  appliedCommitSequence: string,
  commitSequence: string,
): boolean => compareDecimalSequence(commitSequence, appliedCommitSequence) > 0;

export const assertIncarnationMatch = (local: string, received: string): void => {
  if (local !== received) {
    throw syncProtocolError(
      "INCARNATION_MISMATCH",
      `Expected incarnation ${local}, received ${received}.`,
    );
  }
};

export const assertAuthorityHeadNotBehind = (
  appliedCommitSequence: string,
  authorityHorizon: string,
): void => {
  if (compareDecimalSequence(appliedCommitSequence, authorityHorizon) > 0) {
    throw syncProtocolError(
      "SNAPSHOT_REQUIRED",
      `Local applied cursor ${appliedCommitSequence} is ahead of authority horizon ${authorityHorizon}.`,
    );
  }
};
