// @vitest-environment happy-dom
import type { SyncStatus } from "@store/contracts";
import { screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { SyncStatusIndicator } from "@/components/app/sync-status";
import type { Store } from "@/lib/store";

import { renderWithStore } from "../../lib/render";
import { storeStub } from "../../lib/store-stub";

const status = (overrides: Partial<SyncStatus> = {}): SyncStatus => ({
  phase: "idle",
  configured: true,
  lastSyncedAt: null,
  message: "Ready to sync",
  pendingOperations: 0,
  oldestPendingAt: null,
  lastError: null,
  quarantined: false,
  ...overrides,
});

const renderWith = (store: Store) => renderWithStore(<SyncStatusIndicator />, store);

test("reports a configured store as cloud ready", async () => {
  renderWith(storeStub({ getSyncStatus: () => Promise.resolve(status()) }));

  await waitFor(() => {
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("Cloud ready");
  });
});

test("reports an unconfigured store as local only", async () => {
  renderWith(storeStub({ getSyncStatus: () => Promise.resolve(status({ configured: false })) }));

  await waitFor(() => {
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("Local only");
  });
});

test("a store in the error phase reads as paused rather than ready", async () => {
  renderWith(
    storeStub({
      getSyncStatus: () =>
        Promise.resolve(status({ phase: "error", lastError: "network unavailable" })),
    }),
  );

  await waitFor(() => {
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("Sync paused");
  });
});

test("subscribes to pushed status changes and drops the subscription on unmount", async () => {
  const unsubscribe = vi.fn();
  const store = storeStub({
    getSyncStatus: () => Promise.resolve(status()),
    onSyncStatusChange: () => unsubscribe,
  });

  const view = renderWith(store);
  await waitFor(() => expect(screen.getByRole("button")).toBeTruthy());

  view.unmount();
  expect(unsubscribe).toHaveBeenCalled();
});

test("an unstubbed method fails loudly instead of returning a default", async () => {
  await expect(storeStub().listProducts()).rejects.toThrow("listProducts");
});
