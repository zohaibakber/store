import type { CommandExecutionState } from "@store/inventory-react";
import { describe, expect, it } from "vitest";

import { unsyncedOperationId } from "../src/features/sync/pending";
import { syncHealthView, syncNeedsAttention } from "../src/features/sync/sync-health";

describe("sync health", () => {
  it("describes each outbox state", () => {
    expect(syncHealthView({ _tag: "caughtUp" })).toMatchObject({ tone: "synced", canFix: false });
    expect(syncHealthView({ _tag: "savedLocally" })).toMatchObject({ tone: "pending" });
    expect(syncHealthView({ _tag: "pendingConfirmation" }).title).toBe("Uploading");
    expect(syncHealthView({ _tag: "rejected", message: "Batch already exists." })).toEqual({
      tone: "attention",
      title: "A change was rejected",
      detail: "Batch already exists.",
      canFix: true,
    });
    expect(syncHealthView({ _tag: "storageError", message: "Disk full." }).tone).toBe("error");
  });

  it("badges only states that need the user", () => {
    expect(syncNeedsAttention({ _tag: "savedLocally" })).toBe(false);
    expect(syncNeedsAttention({ _tag: "recoveryRequired", message: "Reset" })).toBe(true);
  });

  it("marks the latest local change as unsynced until the outbox catches up", () => {
    const pending: CommandExecutionState = {
      _tag: "pending",
      operationId: "op-1",
      status: "queued",
    };
    expect(unsyncedOperationId(pending, { _tag: "savedLocally" })).toBe("op-1");
    expect(unsyncedOperationId(pending, { _tag: "caughtUp" })).toBeNull();
    expect(unsyncedOperationId({ _tag: "idle" }, { _tag: "pendingConfirmation" })).toBeNull();
  });
});
