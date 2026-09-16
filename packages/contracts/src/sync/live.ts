import * as Schema from "effect/Schema";

import { OrganizationId } from "../ids";
import {
  CommandReceipt,
  MAX_SYNC_IDENTIFIER_LENGTH,
  OrgCommitSequence,
  SyncEpoch,
  SyncSchemaVersion,
  SyncSubscription,
  SyncTransactionGroup,
} from "./protocol";

export const MAX_LIVE_FRAME_TRANSACTIONS = 20;

export const MAX_LIVE_UNACKNOWLEDGED_FRAMES = 8;

export const LIVE_TICKET_LIFETIME_MILLIS = 30_000;

export const LIVE_LEASE_LIFETIME_MILLIS = 15 * 60_000;

const Identifier = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_SYNC_IDENTIFIER_LENGTH),
);

const EpochMillis = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));

export const LiveTicketNonce = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u));
export type LiveTicketNonce = typeof LiveTicketNonce.Type;

export const LiveTicketRequest = Schema.Struct({
  replicaId: Identifier,
  subscription: SyncSubscription,
});
export type LiveTicketRequest = typeof LiveTicketRequest.Type;

export const LiveTicket = Schema.Struct({
  nonce: LiveTicketNonce,
  organizationId: OrganizationId,
  subscription: SyncSubscription,
  expiresAt: EpochMillis,
});
export type LiveTicket = typeof LiveTicket.Type;

export const LiveResumeReason = Schema.Literals([
  "send_window_lost",
  "retention_passed",
  "epoch_changed",
  "lease_expired",
]);
export type LiveResumeReason = typeof LiveResumeReason.Type;

export const SyncLiveServerFrame = Schema.TaggedUnion({
  transactions: {
    epoch: SyncEpoch,
    subscription: SyncSubscription,
    schemaVersion: SyncSchemaVersion,
    fromCommitSequence: OrgCommitSequence,
    toCommitSequence: OrgCommitSequence,
    transactions: Schema.Array(SyncTransactionGroup),
  },
  receipt: {
    epoch: SyncEpoch,
    receipt: CommandReceipt,
  },
  resume: {
    epoch: SyncEpoch,
    reason: LiveResumeReason,
    fromCommitSequence: OrgCommitSequence,
  },
});
export type SyncLiveServerFrame = typeof SyncLiveServerFrame.Type;

export const SyncLiveClientFrame = Schema.TaggedUnion({
  acknowledge: {
    throughCommitSequence: OrgCommitSequence,
  },
});
export type SyncLiveClientFrame = typeof SyncLiveClientFrame.Type;

export const LiveSessionAttachment = Schema.Struct({
  version: Schema.Literal(1),
  organizationId: OrganizationId,
  replicaId: Identifier,
  userId: Identifier,
  subscription: SyncSubscription,
  leaseExpiresAt: EpochMillis,
  acknowledgedCommitSequence: OrgCommitSequence,
});
export type LiveSessionAttachment = typeof LiveSessionAttachment.Type;
