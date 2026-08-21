import { liveSocketUrl } from "@store/contracts";
import * as Effect from "effect/Effect";

import { SyncTransportError } from "./errors";
import type { SyncSocket } from "./session";

const DEFAULT_FAILURE_MESSAGE = "Live sync could not connect.";

/**
 * Shared opener for platform sync sockets. Owns URL construction and transport
 * error wrapping; platforms only supply WebSocket construction (headers/origin).
 */
export const openSyncSocket = (input: {
  readonly baseUrl: string;
  readonly organizationId: string;
  readonly deviceId: string;
  /**
   * Optional token embedded in the live URL query string. Resolved when the
   * Effect runs so reconnects can pick up a refreshed credential.
   */
  readonly accessToken?: () => string | undefined;
  readonly failureMessage?: string;
  readonly connect: (url: URL) => SyncSocket;
}): Effect.Effect<SyncSocket, SyncTransportError> =>
  Effect.try({
    try: () =>
      input.connect(
        liveSocketUrl({
          baseUrl: input.baseUrl,
          organizationId: input.organizationId,
          deviceId: input.deviceId,
          accessToken: input.accessToken?.(),
        }),
      ),
    catch: (cause) =>
      SyncTransportError.make({
        message:
          cause instanceof Error
            ? cause.message
            : (input.failureMessage ?? DEFAULT_FAILURE_MESSAGE),
        retryable: true,
        cause,
      }),
  });
