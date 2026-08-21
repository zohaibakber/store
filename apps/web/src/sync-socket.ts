import { liveSocketUrl } from "@store/contracts/sync-session";
import {
  SyncTransportError,
  syncSocketFromWebSocket,
  type SyncSocket,
} from "@store/persistence/browser";
import * as Effect from "effect/Effect";

export const openBrowserSyncSocket = (input: {
  readonly baseUrl: string;
  readonly organizationId: string;
  readonly deviceId: string;
  readonly getAccessToken: () => string | null;
}): Effect.Effect<SyncSocket, SyncTransportError> =>
  Effect.try({
    try: () => {
      const origin = input.baseUrl || globalThis.location.origin;
      return syncSocketFromWebSocket(
        new WebSocket(
          liveSocketUrl({
            baseUrl: origin,
            organizationId: input.organizationId,
            deviceId: input.deviceId,
            accessToken: input.getAccessToken() ?? undefined,
          }),
        ),
      );
    },
    catch: (cause) =>
      SyncTransportError.make({
        message: cause instanceof Error ? cause.message : "Live sync could not connect.",
        retryable: true,
        cause,
      }),
  });
