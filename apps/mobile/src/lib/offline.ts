import * as Schema from "effect/Schema";

export class OfflineError extends Error {
  override readonly name = "OfflineError";
  constructor(message = "You're offline.") {
    super(message);
  }
}

const NetworkCodedError = Schema.Struct({
  code: Schema.Literal("network_error"),
});

const offlineErrorNames = new Set(["AbortError", "OfflineError"]);
const offlineMessage = /network request failed|failed to fetch|network error|internet|offline/i;

export const isOfflineCause = (cause: unknown) => {
  if (cause instanceof OfflineError) return true;
  if (Schema.is(NetworkCodedError)(cause)) return true;
  if (!(cause instanceof Error)) return false;
  return offlineErrorNames.has(cause.name) || offlineMessage.test(cause.message);
};

export const networkProbeIsDefinitelyOffline = async (
  probe: () => Promise<{
    readonly isConnected?: boolean | null;
    readonly isInternetReachable?: boolean | null;
  }>,
) => {
  try {
    const state = await probe();
    return state.isConnected === false || state.isInternetReachable === false;
  } catch {
    // A failed reachability probe is not proof that the device is offline.
    // Let the real request run so callers can retain a still-valid token when
    // that request fails transiently.
    return false;
  }
};
