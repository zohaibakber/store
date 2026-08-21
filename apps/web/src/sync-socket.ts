import {
  openSyncSocket,
  syncSocketFromWebSocket,
  type SyncSocket,
  SyncTransportError,
} from "@store/persistence/browser";
import * as Effect from "effect/Effect";

export const openBrowserSyncSocket = (input: {
  readonly baseUrl: string;
  readonly organizationId: string;
  readonly deviceId: string;
  readonly getAccessToken: () => string | null;
  /** Refresh near-expiry access before each connect/reconnect. */
  readonly ensureFreshAccess?: () => Promise<void>;
}): Effect.Effect<SyncSocket, SyncTransportError> =>
  openSyncSocket({
    baseUrl: input.baseUrl || globalThis.location.origin,
    organizationId: input.organizationId,
    deviceId: input.deviceId,
    accessToken: () => input.getAccessToken() ?? undefined,
    prepare: input.ensureFreshAccess
      ? Effect.tryPromise({
          try: () => input.ensureFreshAccess!(),
          catch: (cause) =>
            SyncTransportError.make({
              message:
                cause instanceof Error
                  ? cause.message
                  : "Live sync could not refresh authentication.",
              retryable: true,
              cause,
            }),
        })
      : undefined,
    failureMessage: "Live sync could not connect.",
    connect: (url) => syncSocketFromWebSocket(new WebSocket(url)),
  });
