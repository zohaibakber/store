import * as Schema from "effect/Schema";

import { SyncLiveEvent } from "./live";
import { SyncRequest, SyncResponse } from "./schema";

const RequestId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

export const SyncClientExchange = Schema.Struct({
  type: Schema.Literal("exchange"),
  requestId: RequestId,
  request: SyncRequest,
});
export interface SyncClientExchange extends Schema.Schema.Type<typeof SyncClientExchange> {}

export const SyncClientPing = Schema.Struct({
  type: Schema.Literal("ping"),
  requestId: RequestId,
});
export interface SyncClientPing extends Schema.Schema.Type<typeof SyncClientPing> {}

export const SyncClientFrame = Schema.Union([SyncClientExchange, SyncClientPing]);
export type SyncClientFrame = typeof SyncClientFrame.Type;

export const SyncServerExchangeResult = Schema.Struct({
  type: Schema.Literal("exchange-result"),
  requestId: RequestId,
  response: SyncResponse,
});
export interface SyncServerExchangeResult extends Schema.Schema.Type<
  typeof SyncServerExchangeResult
> {}

export const SyncServerExchangeError = Schema.Struct({
  type: Schema.Literal("exchange-error"),
  requestId: RequestId,
  code: Schema.String,
  message: Schema.String,
  retryable: Schema.Boolean,
});
export interface SyncServerExchangeError extends Schema.Schema.Type<
  typeof SyncServerExchangeError
> {}

export const SyncServerPong = Schema.Struct({
  type: Schema.Literal("pong"),
  requestId: RequestId,
});
export interface SyncServerPong extends Schema.Schema.Type<typeof SyncServerPong> {}

export const SyncServerFrame = Schema.Union([
  SyncLiveEvent,
  SyncServerExchangeResult,
  SyncServerExchangeError,
  SyncServerPong,
]);
export type SyncServerFrame = typeof SyncServerFrame.Type;

export const SYNC_LIVE_PATH = "/api/sync/live";

export const liveSocketUrl = (input: {
  readonly baseUrl: string;
  readonly organizationId: string;
  readonly deviceId: string;
  readonly accessToken?: string;
}) => {
  const url = new URL(`${input.baseUrl.replace(/\/$/, "")}${SYNC_LIVE_PATH}`);
  url.protocol =
    url.protocol === "https:" ? "wss:" : url.protocol === "http:" ? "ws:" : url.protocol;
  url.searchParams.set("organizationId", input.organizationId);
  url.searchParams.set("deviceId", input.deviceId);
  url.searchParams.set("protocolVersion", "2");
  if (input.accessToken) url.searchParams.set("access_token", input.accessToken);
  return url;
};
