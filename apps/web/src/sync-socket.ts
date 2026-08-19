import { liveSocketUrl } from "@store/contracts";
import {
  SyncTransportError,
  syncSocketFromHandle,
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
      const socket = new WebSocket(
        liveSocketUrl({
          baseUrl: origin,
          organizationId: input.organizationId,
          deviceId: input.deviceId,
          accessToken: input.getAccessToken() ?? undefined,
        }),
      );
      return syncSocketFromHandle({
        send: (payload) => socket.send(payload),
        close: (code, reason) => socket.close(code, reason),
        listen: (handlers) => {
          const onMessage = (event: MessageEvent) => handlers.message(String(event.data));
          const onError = (event: Event) => handlers.error(event);
          const onClose = (event: CloseEvent) => handlers.close(event.code, event.reason);
          socket.addEventListener("message", onMessage);
          socket.addEventListener("error", onError);
          socket.addEventListener("close", onClose);
          return () => {
            socket.removeEventListener("message", onMessage);
            socket.removeEventListener("error", onError);
            socket.removeEventListener("close", onClose);
          };
        },
      });
    },
    catch: (cause) =>
      SyncTransportError.make({
        message: cause instanceof Error ? cause.message : "Live synchronization could not connect.",
        retryable: true,
        cause,
      }),
  });
