import {
  openSyncSocket,
  SyncTransportError,
  syncSocketFromWebSocket,
  type SyncSocket,
} from "@store/sync-client";
import type * as Effect from "effect/Effect";

import { mobileNativeOrigin } from "@/lib/auth-client";

type NativeWebSocket = {
  new (
    url: string,
    protocols?: string | string[],
    options?: { headers?: Record<string, string> },
  ): WebSocket;
};

export const openMobileSyncSocket = (input: {
  readonly baseUrl: string;
  readonly organizationId: string;
  readonly deviceId: string;
  readonly accessToken: string | null;
}): Effect.Effect<SyncSocket, SyncTransportError> =>
  openSyncSocket({
    baseUrl: input.baseUrl,
    organizationId: input.organizationId,
    deviceId: input.deviceId,
    accessToken: () => input.accessToken ?? undefined,
    failureMessage: "Live synchronization could not connect.",
    connect: (url) =>
      syncSocketFromWebSocket(
        // SAFETY: React Native's WebSocket constructor accepts a third `headers`
        // argument; DOM lib types only declare the two-argument form.
        new (WebSocket as NativeWebSocket)(url.href, undefined, {
          headers: { "expo-origin": mobileNativeOrigin },
        }),
      ),
  });
