import * as Schema from "effect/Schema";

import { SyncIdentifier } from "../schema-primitives";
import {
  OrgCommitSequence,
  SyncEpoch,
  SyncSchemaVersion,
  SyncSubscription,
  SyncTransactionGroup,
} from "./protocol";

export const LIVE_SOCKET_PATH = "/api/sync/live";

export const LIVE_SOCKET_PROTOCOL = "tabaaq.sync.v1";

const LIVE_BEARER_PROTOCOL_PREFIX = "bearer.";

export const LIVE_SOCKET_PING = "ping";

export const LIVE_SOCKET_PONG = "pong";

export const LIVE_SOCKET_CLOSE = {
  normal: 1000,
  tokenExpired: 4001,
  revoked: 4003,
} as const;

export const SyncLiveWakeHint = Schema.Struct({
  epoch: SyncEpoch,
  subscription: SyncSubscription,
  horizon: OrgCommitSequence,
});
export type SyncLiveWakeHint = typeof SyncLiveWakeHint.Type;

const LiveMaxBytes = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
);

export const LiveSocketQuery = Schema.Struct({
  replicaId: SyncIdentifier,
  maxBytes: Schema.optionalKey(LiveMaxBytes),
});
export type LiveSocketQuery = typeof LiveSocketQuery.Type;

const LiveResumeReason = Schema.Literals([
  "send_window_lost",
  "retention_passed",
  "epoch_changed",
  "lease_expired",
]);

export const SyncLiveServerFrame = Schema.TaggedUnion({
  hello: {
    epoch: SyncEpoch,
    horizon: OrgCommitSequence,
  },
  transactions: {
    epoch: SyncEpoch,
    subscription: SyncSubscription,
    schemaVersion: SyncSchemaVersion,
    fromCommitSequence: OrgCommitSequence,
    toCommitSequence: OrgCommitSequence,
    transactions: Schema.Array(SyncTransactionGroup),
  },
  wake: {
    epoch: SyncEpoch,
    horizon: OrgCommitSequence,
  },
  resume: {
    epoch: SyncEpoch,
    reason: LiveResumeReason,
    fromCommitSequence: OrgCommitSequence,
  },
});
export type SyncLiveServerFrame = typeof SyncLiveServerFrame.Type;

export const decodeSyncLiveServerFrame = Schema.decodeUnknownOption(
  Schema.fromJsonString(SyncLiveServerFrame),
);

export const liveBearerProtocol = (accessToken: string): string =>
  `${LIVE_BEARER_PROTOCOL_PREFIX}${accessToken}`;

export const offeredLiveProtocols = (header: string | undefined): ReadonlyArray<string> =>
  header === undefined
    ? []
    : header
        .split(",")
        .map((protocol) => protocol.trim())
        .filter((protocol) => protocol.length > 0);

export const bearerFromLiveProtocols = (protocols: ReadonlyArray<string>): string | undefined => {
  if (!protocols.includes(LIVE_SOCKET_PROTOCOL)) return undefined;
  const bearer = protocols.find((protocol) => protocol.startsWith(LIVE_BEARER_PROTOCOL_PREFIX));
  const token = bearer?.slice(LIVE_BEARER_PROTOCOL_PREFIX.length);
  return token === undefined || token.length === 0 ? undefined : token;
};
