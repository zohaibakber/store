import {
  openSyncSocket,
  syncSocketFromWebSocket,
  type SyncSocket,
  SyncTransportError,
} from "@store/persistence/browser";
import type * as Effect from "effect/Effect";

export const openBrowserSyncSocket = (input: {
  readonly baseUrl: string;
  readonly organizationId: string;
  readonly deviceId: string;
  readonly getAccessToken: () => string | null;
}): Effect.Effect<SyncSocket, SyncTransportError> =>
  openSyncSocket({
    baseUrl: input.baseUrl || globalThis.location.origin,
    organizationId: input.organizationId,
    deviceId: input.deviceId,
    accessToken: () => input.getAccessToken() ?? undefined,
    failureMessage: "Live sync could not connect.",
    connect: (url) => syncSocketFromWebSocket(new WebSocket(url)),
  });
