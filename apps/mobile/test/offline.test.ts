import { describe, expect, it } from "vitest";

import { isOfflineCause, networkProbeIsDefinitelyOffline, OfflineError } from "../src/lib/offline";

describe("offline cause detection", () => {
  it("recognizes explicit offline and abort errors", () => {
    expect(isOfflineCause(new OfflineError())).toBe(true);
    const aborted = new Error("The operation was aborted.");
    aborted.name = "AbortError";
    expect(isOfflineCause(aborted)).toBe(true);
  });

  it("recognizes network error codes", () => {
    expect(isOfflineCause({ code: "network_error" })).toBe(true);
    expect(isOfflineCause(new Error("Network request failed"))).toBe(true);
  });

  it("does not treat unrelated errors as offline", () => {
    expect(isOfflineCause(new Error("Sign in before changing inventory."))).toBe(false);
    expect(isOfflineCause("nope")).toBe(false);
  });
});

describe("networkProbeIsDefinitelyOffline", () => {
  it("only reports explicit disconnected states as offline", async () => {
    await expect(
      networkProbeIsDefinitelyOffline(async () => ({
        isConnected: true,
        isInternetReachable: null,
      })),
    ).resolves.toBe(false);
    await expect(
      networkProbeIsDefinitelyOffline(async () => ({
        isConnected: true,
        isInternetReachable: false,
      })),
    ).resolves.toBe(true);
  });

  it("treats a failed probe as unknown so the real request can run", async () => {
    await expect(
      networkProbeIsDefinitelyOffline(async () => {
        throw new Error("Network state unavailable");
      }),
    ).resolves.toBe(false);
  });
});
