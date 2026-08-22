import * as Schema from "effect/Schema";

import { SYNC_PROTOCOL_VERSION, SyncCursor, SyncPositiveInteger } from "./schema";

export const MAX_LIVE_IDENTIFIER_LENGTH = 200;

export const SyncLiveHello = Schema.Struct({
  type: Schema.Literal("hello"),
  protocolVersion: Schema.Literal(SYNC_PROTOCOL_VERSION),
  headCursor: SyncCursor,
});
export interface SyncLiveHello extends Schema.Schema.Type<typeof SyncLiveHello> {}

export const SyncLiveInvalidate = Schema.Struct({
  type: Schema.Literal("invalidate"),
  protocolVersion: Schema.Literal(SYNC_PROTOCOL_VERSION),
  headCursor: SyncCursor,
});
export interface SyncLiveInvalidate extends Schema.Schema.Type<typeof SyncLiveInvalidate> {}

export const SyncLiveEvent = Schema.Union([SyncLiveHello, SyncLiveInvalidate]);
export type SyncLiveEvent = typeof SyncLiveEvent.Type;

export const SyncLiveAttachment = Schema.Struct({
  organizationId: Schema.String,
  userId: Schema.String,
  deviceId: Schema.String,
  connectionId: Schema.String,
  protocolVersion: Schema.Literal(SYNC_PROTOCOL_VERSION),
  authenticationExpiresAt: SyncPositiveInteger,
});
export interface SyncLiveAttachment extends Schema.Schema.Type<typeof SyncLiveAttachment> {}
