export type UpdateFailure = "network" | "pending-release" | "other";

export type UpdaterEvent =
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available" }
  | { type: "progress"; percent: number }
  | { type: "downloaded"; version: string }
  | {
      type: "error";
      message: string;
      retrying: boolean;
      failure: UpdateFailure;
    };

export type UpdatePhase = "idle" | "downloading" | "downloaded";

export const nextUpdatePhase = (phase: UpdatePhase, event: UpdaterEvent): UpdatePhase => {
  switch (event.type) {
    case "progress":
      return "downloading";
    case "downloaded":
      return "downloaded";
    case "error":
      return "idle";
    case "checking":
    case "available":
    case "not-available":
      return phase;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
};

export const forwardsToRenderer = (phase: UpdatePhase, event: UpdaterEvent): boolean =>
  event.type === "available" || event.type === "error" ? phase === "idle" : true;

/**
 * Chromium `net::ERR_*` and Node syscall failures that mean "no usable
 * network", not "the update service rejected us". Offline is a normal
 * mode for this app; these must not surface as user-facing errors.
 */
const CONNECTIVITY_FAILURE =
  /net::ERR_(INTERNET_DISCONNECTED|NETWORK_CHANGED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|ADDRESS_UNREACHABLE|CONNECTION_|TIMED_OUT|NETWORK_IO_SUSPENDED|NETWORK_ACCESS_DENIED)|Failed to fetch|Network request failed|Load failed|The Internet connection appears to be offline|ENOTFOUND|ENETUNREACH|ENETDOWN|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH/i;

export const isConnectivityFailure = (message: string): boolean =>
  CONNECTIVITY_FAILURE.test(message);

export const classifyUpdateFailure = (message: string): UpdateFailure => {
  if (isConnectivityFailure(message)) return "network";
  if (message.includes("latest-linux.yml") && message.includes("404")) return "pending-release";
  return "other";
};

export const updateFailureMessage = (message: string): string => {
  switch (classifyUpdateFailure(message)) {
    case "pending-release":
      return "The latest release is still publishing its Linux update details. Tabaaq will retry automatically.";
    case "network":
      return "You're offline.";
    case "other": {
      const first = (message.split("\n")[0] ?? "").trim();
      if (!first || first.startsWith("net::") || first.startsWith("Error invoking remote method")) {
        return "Unable to check for updates.";
      }
      return first;
    }
  }
};
