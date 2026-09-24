import { describe, expect, it } from "vitest";

import {
  syncHealthFromScheduler,
  syncStatusFromOutbox,
  syncStatusWithHealth,
} from "../src/replica/status";

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

describe("syncHealthFromScheduler", () => {
  it("maps halting scheduler statuses onto replica sync health", () => {
    expect(syncHealthFromScheduler({ _tag: "running" })).toEqual({ _tag: "running" });
    expect(syncHealthFromScheduler({ _tag: "pausedForAuth", status: 401 })).toEqual({
      _tag: "running",
    });
    expect(syncHealthFromScheduler({ _tag: "storageError", message: "Disk full." })).toEqual({
      _tag: "storageError",
      message: "Disk full.",
    });
    expect(
      syncHealthFromScheduler({
        _tag: "recoveryRequired",
        code: "EPOCH_MISMATCH",
        message: "The sync authority was restored.",
      }),
    ).toEqual({ _tag: "recoveryRequired", message: "The sync authority was restored." });
  });

  it("lets a halted scheduler override the outbox status", () => {
    expect(syncStatusWithHealth({ _tag: "savedLocally" }, { _tag: "running" })).toEqual({
      _tag: "savedLocally",
    });
    expect(
      syncStatusWithHealth({ _tag: "caughtUp" }, { _tag: "storageError", message: "Disk full." }),
    ).toEqual({ _tag: "storageError", message: "Disk full." });
    expect(
      syncStatusWithHealth(
        { _tag: "pendingConfirmation" },
        { _tag: "recoveryRequired", message: "Recovery required." },
      ),
    ).toEqual({ _tag: "recoveryRequired", message: "Recovery required." });
  });
});
