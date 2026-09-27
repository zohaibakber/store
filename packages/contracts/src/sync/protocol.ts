import * as Order from "effect/Order";
import * as Schema from "effect/Schema";

import { CatalogWriteCommand } from "../catalog/write";
import { InvoiceId, OrganizationId } from "../ids";
import { PositiveInt, Sha256Hex, SyncIdentifier } from "../schema-primitives";
import { IssueInvoiceCommand } from "../store/schema";
import { SyncEntityChange } from "./schema";

export const MAX_SYNC_PULL_TRANSACTIONS = 100;

export const SYNC_SCHEMA_VERSION = 1;

export const SyncSchemaVersion = PositiveInt;
export type SyncSchemaVersion = typeof SyncSchemaVersion.Type;

export const SyncSubscription = Schema.Literals(["operational"]);
export type SyncSubscription = typeof SyncSubscription.Type;

export const OPERATIONAL_SUBSCRIPTION: SyncSubscription = "operational";

export const DecimalSequence = Schema.String.check(Schema.isPattern(/^[0-9]+$/u));
export type DecimalSequence = typeof DecimalSequence.Type;

const withoutLeadingZeros = (value: string): string => value.replace(/^0+(?=\d)/u, "");

export const compareDecimalSequence: Order.Order<string> = Order.mapInput(
  Order.combine(
    Order.mapInput(Order.Number, (value: string) => value.length),
    Order.String,
  ),
  withoutLeadingZeros,
);

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

export const PayloadHash = Sha256Hex;
export type PayloadHash = typeof PayloadHash.Type;

export const PartitionDigest = Sha256Hex;
export type PartitionDigest = typeof PartitionDigest.Type;

export const AuthorityIncarnation = SyncIdentifier.pipe(Schema.brand("AuthorityIncarnation"));
export type AuthorityIncarnation = typeof AuthorityIncarnation.Type;

export const MAX_TRANSPORT_PAYLOAD_BYTES = 900_000;

export const MAX_COMMAND_ATTEMPTS = 8;

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
  "INCARNATION_MISMATCH",
  "COMMAND_ABANDONED",
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

export const CatalogWriteSyncCommand = Schema.Struct({
  _tag: Schema.Literal("catalogWrite"),
  payload: CatalogWriteCommand,
});
export type CatalogWriteSyncCommand = typeof CatalogWriteSyncCommand.Type;

export const SyncCommand = Schema.Union([IssueInvoiceSyncCommand, CatalogWriteSyncCommand]);
export type SyncCommand = typeof SyncCommand.Type;

export const SyncCommandEnvelope = Schema.Struct({
  organizationId: OrganizationId,
  epoch: SyncEpoch,
  replicaId: SyncIdentifier,
  clientSequence: ReplicaClientSequence,
  operationId: SyncIdentifier,
  payloadHash: PayloadHash,
  command: SyncCommand,
});
export type SyncCommandEnvelope = typeof SyncCommandEnvelope.Type;

export const CommandDecision = Schema.Literals(["accepted", "rejected"]);
export type CommandDecision = typeof CommandDecision.Type;

export const AcceptedInvoiceResult = Schema.Struct({
  _tag: Schema.Literal("issueInvoice"),
  invoiceId: InvoiceId,
  invoiceNumber: PositiveInt,
});
export type AcceptedInvoiceResult = typeof AcceptedInvoiceResult.Type;

export const AcceptedCatalogWriteResult = Schema.Struct({
  _tag: Schema.Literal("catalogWrite"),
  rowsWritten: Schema.Natural,
});
export type AcceptedCatalogWriteResult = typeof AcceptedCatalogWriteResult.Type;

export const RejectedCommandResult = Schema.Struct({
  _tag: Schema.Literal("rejected"),
  code: SyncProtocolCode,
  message: Schema.String,
});
export type RejectedCommandResult = typeof RejectedCommandResult.Type;

export const CommandReceipt = Schema.Struct({
  operationId: SyncIdentifier,
  replicaId: SyncIdentifier,
  clientSequence: ReplicaClientSequence,
  payloadHash: PayloadHash,
  decision: CommandDecision,
  commitSequence: OrgCommitSequence,
  result: Schema.Union([AcceptedInvoiceResult, AcceptedCatalogWriteResult, RejectedCommandResult]),
});
export type CommandReceipt = typeof CommandReceipt.Type;

export const RegisterReplicaRequest = Schema.Struct({
  replicaId: SyncIdentifier,
  deviceLabel: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
});
export type RegisterReplicaRequest = typeof RegisterReplicaRequest.Type;

export const RegisterReplicaResult = Schema.Struct({
  replicaId: SyncIdentifier,
  epoch: SyncEpoch,
  incarnation: AuthorityIncarnation,
  nextClientSequence: ReplicaClientSequence,
  retentionFloor: OrgCommitSequence,
  horizon: OrgCommitSequence,
  schemaVersion: SyncSchemaVersion,
});
export type RegisterReplicaResult = typeof RegisterReplicaResult.Type;

export const SyncPullRequest = Schema.Struct({
  epoch: SyncEpoch,
  subscription: SyncSubscription,
  afterCommitSequence: OrgCommitSequence,
  limit: Schema.optionalKey(
    PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_SYNC_PULL_TRANSACTIONS)),
  ),
  includeDigest: Schema.optionalKey(Schema.Boolean),
});
export type SyncPullRequest = typeof SyncPullRequest.Type;

export const SyncLogChange = SyncEntityChange;
export type SyncLogChange = typeof SyncLogChange.Type;

export const SyncTransactionGroup = Schema.Struct({
  commitSequence: OrgCommitSequence,
  operationId: SyncIdentifier,
  decision: CommandDecision,
  changes: Schema.Array(SyncLogChange),
});
export type SyncTransactionGroup = typeof SyncTransactionGroup.Type;

export const SyncPullResult = Schema.Struct({
  epoch: SyncEpoch,
  incarnation: AuthorityIncarnation,
  subscription: SyncSubscription,
  schemaVersion: SyncSchemaVersion,
  transactions: Schema.Array(SyncTransactionGroup),
  nextCommitSequence: OrgCommitSequence,
  horizon: OrgCommitSequence,
  retentionFloor: OrgCommitSequence,
  digest: Schema.optionalKey(PartitionDigest),
});
export type SyncPullResult = typeof SyncPullResult.Type;

export const SyncCoverage = Schema.TaggedUnion({
  awaitingSnapshot: {
    subscription: SyncSubscription,
  },
  downloaded: {
    subscription: SyncSubscription,
    throughCommitSequence: OrgCommitSequence,
    digest: PartitionDigest,
  },
});
export type SyncCoverage = typeof SyncCoverage.Type;
