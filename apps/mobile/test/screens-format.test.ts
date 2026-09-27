import type { CommandExecutionState } from "@store/inventory-react";
import { describe, expect, it } from "vitest";

import {
  appVersionLabel,
  formatPrice,
  formatSignedCount,
  initialsOf,
} from "../src/features/format";
import {
  invoiceItemQuantity,
  invoiceSubtitle,
  invoiceTitle,
} from "../src/features/sales/invoice-text";
import { unsyncedOperationId } from "../src/features/sync/pending";
import { syncHealthView, syncNeedsAttention } from "../src/features/sync/sync-health";

const now = new Date(2026, 8, 24, 12).getTime();

describe("formatting", () => {
  it("formats paisa as rupees", () => {
    expect(formatPrice(null)).toBe("—");
    expect(formatPrice(123_450)).toMatch(/Rs\s?1,23[45]/);
  });

  it("signs counts with a true minus", () => {
    expect(formatSignedCount(4)).toBe("+4");
    expect(formatSignedCount(-1200)).toBe("−1,200");
    expect(formatSignedCount(0)).toBe("0");
  });

  it("derives initials and version labels", () => {
    expect(initialsOf("  zohaib akber ")).toBe("ZA");
    expect(initialsOf("")).toBe("");
    expect(appVersionLabel("1.0.0", "7")).toBe("1.0.0 (7)");
    expect(appVersionLabel(null, "7")).toBe("Unknown");
  });
});

describe("invoice text", () => {
  it("titles and summarises an invoice", () => {
    expect(invoiceTitle(42)).toBe("Invoice 0042");
    const subtitle = invoiceSubtitle({ createdAt: now, customerName: " Ali ", items: [] });
    expect(subtitle).toContain("0 items");
    expect(subtitle.endsWith("· Ali")).toBe(true);
  });

  it("describes line quantities", () => {
    expect(invoiceItemQuantity({ quantity: 1, quantityType: "pack" })).toBe("1 pack");
    expect(invoiceItemQuantity({ quantity: 3, quantityType: "unit" })).toBe("3 units");
  });
});

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
