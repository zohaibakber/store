import type { InventorySyncActivity, RejectedCommand } from "@store/inventory-react";
import { describe, expect, it } from "vitest";

import {
  firstFixableProduct,
  lastSyncedLabel,
  pendingLabel,
  rejectionReason,
  syncActivityView,
} from "../src/features/sync/sync-activity";

const now = new Date(2026, 8, 24, 12).getTime();

const rejected = (overrides: Partial<RejectedCommand>): RejectedCommand => ({
  operationId: "op-1",
  clientSequence: "1",
  createdAt: now - 5_000,
  command: "catalogWrite",
  code: "ENTITY_CONFLICT",
  message: "The batch changed on another device.",
  targets: [{ entity: "batch", id: "batch-1" }],
  productId: "product-1",
  ...overrides,
});

const activity = (overrides: Partial<InventorySyncActivity>): InventorySyncActivity => ({
  pendingCount: 0,
  rejectedCount: 0,
  rejected: [],
  lastCaughtUpAt: null,
  ...overrides,
});

describe("sync activity view", () => {
  it("describes the last successful sync relative to now", () => {
    expect(lastSyncedLabel(null, now)).toBe("Not synced on this phone yet");
    expect(lastSyncedLabel(now - 30_000, now)).toBe("Synced just now");
    expect(lastSyncedLabel(now - 5 * 60_000, now)).toBe("Synced 5 min ago");
    expect(lastSyncedLabel(now - 3 * 3_600_000, now)).toBe("Synced 3 h ago");
    expect(lastSyncedLabel(now - 3 * 86_400_000, now)).toMatch(/^Synced 21 Sep/u);
    expect(lastSyncedLabel(now + 10_000, now)).toBe("Synced just now");
  });

  it("counts changes waiting to upload", () => {
    expect(pendingLabel(0)).toBe("Nothing waiting to upload");
    expect(pendingLabel(1)).toBe("1 change waiting to upload");
    expect(pendingLabel(1_200)).toBe("1,200 changes waiting to upload");
  });

  it("names rejection reasons and keeps unknown codes generic", () => {
    expect(rejectionReason("INSUFFICIENT_STOCK")).toBe("Not enough stock");
    expect(rejectionReason("constructor")).toBe("Rejected");
    expect(rejectionReason("SOMETHING_NEW")).toBe("Rejected");
  });

  it("lists rejected changes with a fix target and counts the ones not shown", () => {
    const sale = rejected({
      operationId: "op-2",
      command: "issueInvoice",
      code: "INSUFFICIENT_STOCK",
      message: "Only 2 left.",
      productId: "product-2",
    });
    const orphan = rejected({ operationId: "op-3", productId: null });
    const view = syncActivityView(
      activity({ pendingCount: 2, rejectedCount: 5, rejected: [sale, orphan] }),
      now,
    );
    expect(view.pending.title).toBe("2 changes waiting to upload");
    expect(view.rejected).toEqual([
      {
        key: "op-2",
        title: "Sale: Not enough stock",
        detail: "Only 2 left.",
        productId: "product-2",
      },
      {
        key: "op-3",
        title: "Stock change: Changed on another device",
        detail: "The batch changed on another device.",
        productId: null,
      },
    ]);
    expect(view.hiddenRejected).toBe(3);
  });

  it("routes the overall fix to the first rejected change that names a product", () => {
    expect(firstFixableProduct(activity({}))).toBeNull();
    expect(
      firstFixableProduct(
        activity({
          rejected: [rejected({ productId: null }), rejected({ productId: "product-9" })],
        }),
      ),
    ).toBe("product-9");
  });
});
