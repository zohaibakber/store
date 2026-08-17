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

const offlineErrorNames = new Set(["AbortError", "OfflineError", "ClerkOfflineError"]);
const offlineMessage = /network request failed|failed to fetch|network error|internet|offline/i;

export const isOfflineCause = (cause: unknown) => {
  if (cause instanceof OfflineError) return true;
  if (Schema.is(NetworkCodedError)(cause)) return true;
  if (!(cause instanceof Error)) return false;
  return offlineErrorNames.has(cause.name) || offlineMessage.test(cause.message);
};
