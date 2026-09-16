import { describe, expect, it } from "vitest";

import { syncStatusFromOutbox } from "../src/replica/status";

describe("syncStatusFromOutbox", () => {
  it("maps outbox rows onto the named desktop states", () => {
    expect(syncStatusFromOutbox([])).toEqual({ _tag: "caughtUp" });
    expect(syncStatusFromOutbox(["pending"])).toEqual({ _tag: "savedLocally" });
    expect(syncStatusFromOutbox(["sending"])).toEqual({ _tag: "pendingConfirmation" });
    expect(syncStatusFromOutbox(["accepted_awaiting_integration"])).toEqual({
      _tag: "pendingConfirmation",
    });
    expect(syncStatusFromOutbox(["rejected"])).toEqual({
      _tag: "rejected",
      message: "The authority rejected a local command.",
    });
  });
});
