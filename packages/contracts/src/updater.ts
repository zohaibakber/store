export type UpdaterEvent =
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available" }
  | { type: "progress"; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string; retrying: boolean };

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

export type UpdateFailure = "network" | "pending-release" | "other";

export const classifyUpdateFailure = (message: string): UpdateFailure => {
  if (
    /net::ERR_INTERNET_DISCONNECTED|ENOTFOUND|ENETUNREACH|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT/.test(
      message,
    )
  )
    return "network";
  if (message.includes("latest-linux.yml") && message.includes("404")) return "pending-release";
  return "other";
};

export const updateFailureMessage = (message: string): string =>
  classifyUpdateFailure(message) === "pending-release"
    ? "The latest release is still publishing its Linux update details. Tabaaq will retry automatically."
    : (message.split("\n")[0] ?? "") || "Unable to check for updates.";
