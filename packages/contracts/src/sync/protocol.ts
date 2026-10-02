import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";

import { CatalogWriteCommand } from "../catalog/write";
import { InvoiceId, OrganizationId } from "../ids";
import { PositiveInt, Sha256Hex, SyncIdentifier } from "../schema-primitives";
import { IssueInvoiceCommand } from "../store/schema";
import { knownEntityRecords, SyncEntityChange } from "./schema";

export const MAX_SYNC_PULL_TRANSACTIONS = 1_000;

export const SYNC_SCHEMA_VERSION = 2;

export const SyncSchemaVersion = PositiveInt;
export type SyncSchemaVersion = typeof SyncSchemaVersion.Type;

export const SyncSubscription = Schema.Literals(["operational"]);
export type SyncSubscription = typeof SyncSubscription.Type;

export const OPERATIONAL_SUBSCRIPTION: SyncSubscription = "operational";

const DecimalSequence = Schema.String.check(Schema.isPattern(/^[0-9]+$/u));

const withoutLeadingZeros = (value: string): string => value.replace(/^0+(?=\d)/u, "");

export const compareDecimalSequence: Order.Order<string> = Order.mapInput(
  Order.combine(
    Order.mapInput(Order.Number, (value: string) => value.length),
    Order.String,
  ),
  withoutLeadingZeros,
);

export const incrementDecimalSequence = (value: string): string => String(BigInt(value) + 1n);

export const unpadDecimalSequence = (value: string): string => String(BigInt(value));

export const SyncEpoch = DecimalSequence.pipe(Schema.brand("SyncEpoch"));
export type SyncEpoch = typeof SyncEpoch.Type;

export const OrgCommitSequence = DecimalSequence.pipe(Schema.brand("OrgCommitSequence"));
export type OrgCommitSequence = typeof OrgCommitSequence.Type;

export const ReplicaClientSequence = DecimalSequence.pipe(Schema.brand("ReplicaClientSequence"));
export type ReplicaClientSequence = typeof ReplicaClientSequence.Type;

const PayloadHash = Sha256Hex;

export const PartitionDigest = Sha256Hex;
export type PartitionDigest = typeof PartitionDigest.Type;

export const PARTITION_DIGEST_VERSION = 4 as const;

export const PARTITION_DIGEST_VERSION_V3 = 3 as const;

const PartitionDigestVersion = Schema.Literal(PARTITION_DIGEST_VERSION);

export const RequestedPartitionDigestVersion = Schema.Literals([
  PARTITION_DIGEST_VERSION_V3,
  PARTITION_DIGEST_VERSION,
]);
export type RequestedPartitionDigestVersion = typeof RequestedPartitionDigestVersion.Type;

export const PartitionDigestReport = Schema.Struct({
  version: PartitionDigestVersion,
  digest: PartitionDigest,
  count: Schema.Natural,
  entities: Schema.Struct({
    category: PartitionDigest,
    product: PartitionDigest,
    batch: PartitionDigest,
    invoice: PartitionDigest,
    invoiceItem: PartitionDigest,
    stockMovement: PartitionDigest,
    supplier: PartitionDigest,
    purchaseOrder: PartitionDigest,
    purchaseOrderItem: PartitionDigest,
  }),
});
export type PartitionDigestReport = typeof PartitionDigestReport.Type;

export const AuthorityIncarnation = SyncIdentifier.pipe(Schema.brand("AuthorityIncarnation"));
export type AuthorityIncarnation = typeof AuthorityIncarnation.Type;

export const MAX_TRANSPORT_PAYLOAD_BYTES = 900_000;

export const MIN_PULL_BYTE_BUDGET = 65_536;

const PullByteBudget = PositiveInt;

export const SyncProtocolCode = Schema.Literals([
  "ORGANIZATION_MISMATCH",
  "INVALID_OPERATION",
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
  "SNAPSHOT_REQUIRED",
  "SNAPSHOT_UNAVAILABLE",
  "SCHEMA_VERSION_UNSUPPORTED",
  "INCARNATION_MISMATCH",
  "SUPPLIER_HAS_ORDERS",
  "PURCHASE_ORDER_TRANSITION_INVALID",
  "PURCHASE_ORDER_NOT_OPEN",
  "PURCHASE_ORDER_NOT_DRAFT",
  "PURCHASE_ORDER_HAS_ITEMS",
  "PURCHASE_ORDER_ITEM_QUANTITY_INVALID",
  "PURCHASE_ORDER_ITEM_RECEIVED",
  "PURCHASE_ORDER_RECEIPT_PRODUCT_MISMATCH",
  "REPLICA_SCHEMA_OUTDATED",
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

export const SyncCommand = Schema.TaggedUnion({
  issueInvoice: { payload: IssueInvoiceCommand },
  catalogWrite: { payload: CatalogWriteCommand },
});
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

export const EnqueueCommandRequest = Schema.Struct({
  operationId: SyncIdentifier,
  command: SyncCommand,
  occurredAt: Schema.Natural,
});
export type EnqueueCommandRequest = typeof EnqueueCommandRequest.Type;

export const SyncSubmitCommandRequest = SyncCommandEnvelope.pipe(
  Schema.fieldsAssign({
    afterCommitSequence: OrgCommitSequence,
    maxBytes: Schema.optionalKey(PullByteBudget),
  }),
);
export type SyncSubmitCommandRequest = typeof SyncSubmitCommandRequest.Type;

const CommandDecision = Schema.Literals(["accepted", "rejected"]);

const CommandResult = Schema.TaggedUnion({
  issueInvoice: { invoiceId: InvoiceId, invoiceNumber: PositiveInt },
  catalogWrite: { rowsWritten: Schema.Natural },
  rejected: { code: SyncProtocolCode, message: Schema.String },
});

export const CommandReceipt = Schema.Struct({
  operationId: SyncIdentifier,
  replicaId: SyncIdentifier,
  clientSequence: ReplicaClientSequence,
  payloadHash: PayloadHash,
  decision: CommandDecision,
  commitSequence: OrgCommitSequence,
  result: CommandResult,
});
export type CommandReceipt = typeof CommandReceipt.Type;

const MAX_DEVICE_LABEL_LENGTH = 64;

export const DeviceLabel = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_DEVICE_LABEL_LENGTH),
);
export type DeviceLabel = typeof DeviceLabel.Type;

const decodeDeviceLabel = Schema.decodeUnknownOption(DeviceLabel);

export const deviceLabelOf = (name: string): DeviceLabel | undefined =>
  Option.getOrUndefined(
    decodeDeviceLabel(
      name
        .replace(/[\p{Cc}\p{Cf}\s]+/gu, " ")
        .trim()
        .slice(0, MAX_DEVICE_LABEL_LENGTH)
        .replace(/[\uD800-\uDBFF]$/u, "")
        .trim(),
    ),
  );

export const RegisterReplicaRequest = Schema.Struct({
  replicaId: SyncIdentifier,
  deviceLabel: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
  schemaVersion: Schema.optionalKey(SyncSchemaVersion),
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
  lowestActiveSchemaVersion: Schema.optionalKey(SyncSchemaVersion),
});
export type RegisterReplicaResult = typeof RegisterReplicaResult.Type;

export const SyncPullRequest = Schema.Struct({
  epoch: SyncEpoch,
  subscription: SyncSubscription,
  afterCommitSequence: OrgCommitSequence,
  digestVersion: Schema.optionalKey(RequestedPartitionDigestVersion),
  maxBytes: Schema.optionalKey(PullByteBudget),
});
export type SyncPullRequest = typeof SyncPullRequest.Type;

export const SyncLogChange = SyncEntityChange;
export type SyncLogChange = typeof SyncLogChange.Type;

export const SyncTransactionGroup = Schema.Struct({
  commitSequence: OrgCommitSequence,
  operationId: SyncIdentifier,
  decision: CommandDecision,
  changes: knownEntityRecords(SyncLogChange),
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
  digest: Schema.optionalKey(PartitionDigestReport),
});
export type SyncPullResult = typeof SyncPullResult.Type;

export const SyncSubmitCommandResult = CommandReceipt.pipe(
  Schema.fieldsAssign({
    page: Schema.optionalKey(SyncPullResult),
  }),
);
export type SyncSubmitCommandResult = typeof SyncSubmitCommandResult.Type;

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
