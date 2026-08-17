import { describe, expect, it } from "vitest";

import { isOfflineCause, OfflineError } from "../src/lib/offline";

describe("offline cause detection", () => {
  it("recognizes explicit offline and abort errors", () => {
    expect(isOfflineCause(new OfflineError())).toBe(true);
    const aborted = new Error("The operation was aborted.");
    aborted.name = "AbortError";
    expect(isOfflineCause(aborted)).toBe(true);
    const clerkOffline = new Error("Clerk is offline");
    clerkOffline.name = "ClerkOfflineError";
    expect(isOfflineCause(clerkOffline)).toBe(true);
  });

  it("recognizes Clerk network error codes", () => {
    expect(isOfflineCause({ code: "network_error" })).toBe(true);
    expect(isOfflineCause(new Error("Network request failed"))).toBe(true);
  });

  it("does not treat unrelated errors as offline", () => {
    expect(isOfflineCause(new Error("Sign in before changing inventory."))).toBe(false);
    expect(isOfflineCause("nope")).toBe(false);
  });
});
