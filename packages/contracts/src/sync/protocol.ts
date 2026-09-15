import * as Schema from "effect/Schema";

import { InvoiceId, OrganizationId } from "../ids";
import { IssueInvoiceCommand } from "../store/schema";
import { compareCodeUnits } from "./canonical-json";
import { SyncAction, SyncEntity } from "./schema";

export const MAX_SYNC_PULL_TRANSACTIONS = 100;

export const MAX_SYNC_IDENTIFIER_LENGTH = 200;

const Identifier = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_SYNC_IDENTIFIER_LENGTH),
);

export const SYNC_SCHEMA_VERSION = 1;

export const SyncSchemaVersion = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
);
export type SyncSchemaVersion = typeof SyncSchemaVersion.Type;

export const SyncSubscription = Schema.Literals(["operational"]);
export type SyncSubscription = typeof SyncSubscription.Type;

export const OPERATIONAL_SUBSCRIPTION: SyncSubscription = "operational";

export const DecimalSequence = Schema.String.check(Schema.isPattern(/^[0-9]+$/u));
export type DecimalSequence = typeof DecimalSequence.Type;

export const compareDecimalSequence = (left: string, right: string): number => {
  const normalizedLeft = left.replace(/^0+(?=\d)/u, "");
  const normalizedRight = right.replace(/^0+(?=\d)/u, "");
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length < normalizedRight.length ? -1 : 1;
  }
  return compareCodeUnits(normalizedLeft, normalizedRight);
};

export const incrementDecimalSequence = (value: string): string => String(BigInt(value) + 1n);

export const DECIMAL_SEQUENCE_DIGITS = 20;

export const padDecimalSequence = (value: string): string =>
  String(BigInt(value)).padStart(DECIMAL_SEQUENCE_DIGITS, "0");

export const unpadDecimalSequence = (value: string): string => String(BigInt(value));

export const SyncEpoch = DecimalSequence.pipe(Schema.brand("SyncEpoch"));
export type SyncEpoch = typeof SyncEpoch.Type;

export const OrgCommitSequence = DecimalSequence.pipe(Schema.brand("OrgCommitSequence"));
export type OrgCommitSequence = typeof OrgCommitSequence.Type;

export const ReplicaClientSequence = DecimalSequence.pipe(Schema.brand("ReplicaClientSequence"));
export type ReplicaClientSequence = typeof ReplicaClientSequence.Type;

export const PayloadHash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u));
export type PayloadHash = typeof PayloadHash.Type;

export const SyncProtocolCode = Schema.Literals([
  "ORGANIZATION_MISMATCH",
  "ACTOR_MISMATCH",
  "INVALID_OPERATION",
  "INVALID_DEVICE",
  "INVALID_OCCURRED_AT",
  "OPERATION_ID_REUSED",
  "INSUFFICIENT_STOCK",
  "INVOICE_IDENTITY_CONFLICT",
  "ENTITY_CONFLICT",
  "ENTITY_RELATION_INVALID",
  "ENTITY_WRITE_FAILED",
  "REPLICA_SEQUENCE_GAP",
  "EPOCH_MISMATCH",
  "REPLICA_UNKNOWN",
  "REPLICA_OWNED_BY_OTHER",
  "COMMAND_IDENTITY_MISMATCH",
  "INVALID_PAYLOAD_HASH",
  "IMPORT_IDENTITY_MISMATCH",
  "SNAPSHOT_REQUIRED",
  "SNAPSHOT_UNAVAILABLE",
  "SCHEMA_VERSION_UNSUPPORTED",
  "TICKET_INVALID",
]);
export type SyncProtocolCode = typeof SyncProtocolCode.Type;

export class SyncProtocolError extends Schema.TaggedError<SyncProtocolError>()(
  "SyncProtocolError",
  {
    code: SyncProtocolCode,
    message: Schema.String,
  },
) {}

export const syncProtocolError = (code: SyncProtocolCode, message: string): SyncProtocolError =>
  SyncProtocolError.make({ code, message });

export const IssueInvoiceSyncCommand = Schema.Struct({
  _tag: Schema.Literal("issueInvoice"),
  payload: IssueInvoiceCommand,
});
export type IssueInvoiceSyncCommand = typeof IssueInvoiceSyncCommand.Type;

export const SyncCommand = Schema.Union([IssueInvoiceSyncCommand]);
export type SyncCommand = typeof SyncCommand.Type;

export const SyncCommandEnvelope = Schema.Struct({
  organizationId: OrganizationId,
  epoch: SyncEpoch,
  replicaId: Identifier,
  clientSequence: ReplicaClientSequence,
  operationId: Identifier,
  payloadHash: PayloadHash,
  command: SyncCommand,
});
export type SyncCommandEnvelope = typeof SyncCommandEnvelope.Type;

export const CommandDecision = Schema.Literals(["accepted", "rejected"]);
export type CommandDecision = typeof CommandDecision.Type;

export const AcceptedInvoiceResult = Schema.Struct({
  _tag: Schema.Literal("issueInvoice"),
  invoiceId: InvoiceId,
  invoiceNumber: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
});
export type AcceptedInvoiceResult = typeof AcceptedInvoiceResult.Type;

export const RejectedCommandResult = Schema.Struct({
  _tag: Schema.Literal("rejected"),
  code: SyncProtocolCode,
  message: Schema.String,
});
export type RejectedCommandResult = typeof RejectedCommandResult.Type;

export const CommandReceipt = Schema.Struct({
  operationId: Identifier,
  replicaId: Identifier,
  clientSequence: ReplicaClientSequence,
  payloadHash: PayloadHash,
  decision: CommandDecision,
  commitSequence: OrgCommitSequence,
  result: Schema.Union([AcceptedInvoiceResult, RejectedCommandResult]),
});
export type CommandReceipt = typeof CommandReceipt.Type;

export const RegisterReplicaRequest = Schema.Struct({
  replicaId: Identifier,
  deviceLabel: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
});
export type RegisterReplicaRequest = typeof RegisterReplicaRequest.Type;

export const RegisterReplicaResult = Schema.Struct({
  replicaId: Identifier,
  epoch: SyncEpoch,
  nextClientSequence: ReplicaClientSequence,
  retentionFloor: OrgCommitSequence,
  schemaVersion: SyncSchemaVersion,
});
export type RegisterReplicaResult = typeof RegisterReplicaResult.Type;

export const SyncPullRequest = Schema.Struct({
  epoch: SyncEpoch,
  subscription: SyncSubscription,
  afterCommitSequence: OrgCommitSequence,
  limit: Schema.optionalKey(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(MAX_SYNC_PULL_TRANSACTIONS),
    ),
  ),
});
export type SyncPullRequest = typeof SyncPullRequest.Type;

export const SyncLogChange = Schema.Struct({
  entity: SyncEntity,
  action: SyncAction,
  entityId: Schema.String,
  rowVersion: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  row: Schema.Unknown,
});
export type SyncLogChange = typeof SyncLogChange.Type;

export const SyncTransactionGroup = Schema.Struct({
  commitSequence: OrgCommitSequence,
  operationId: Identifier,
  decision: CommandDecision,
  changes: Schema.Array(SyncLogChange),
});
export type SyncTransactionGroup = typeof SyncTransactionGroup.Type;

export const SyncPullResult = Schema.Struct({
  epoch: SyncEpoch,
  subscription: SyncSubscription,
  schemaVersion: SyncSchemaVersion,
  transactions: Schema.Array(SyncTransactionGroup),
  nextCommitSequence: OrgCommitSequence,
  horizon: OrgCommitSequence,
  retentionFloor: OrgCommitSequence,
});
export type SyncPullResult = typeof SyncPullResult.Type;

export const SyncCoverage = Schema.TaggedUnion({
  awaitingSnapshot: {
    subscription: SyncSubscription,
  },
  downloaded: {
    subscription: SyncSubscription,
    throughCommitSequence: OrgCommitSequence,
  },
});
export type SyncCoverage = typeof SyncCoverage.Type;
