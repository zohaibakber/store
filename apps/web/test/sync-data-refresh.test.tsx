// @vitest-environment happy-dom
import type { SyncStatus } from "@store/contracts";
import { act, render } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { SyncDataRefresh } from "@/sync-data-refresh";

import { storeStub } from "./lib/store-stub";

const status = (phase: SyncStatus["phase"], lastSyncedAt: number | null): SyncStatus => ({
  phase,
  lastSyncedAt,
  message: phase,
  pendingOperations: 0,
  oldestPendingAt: null,
  lastError: null,
  quarantined: false,
});

test("refreshes route and component data when a background sync completes", async () => {
  let publishStatus: ((status: SyncStatus) => void) | undefined;
  const refreshRoutes = vi.fn(() => Promise.resolve());
  const dashboardRefresh = vi.fn();
  window.addEventListener("offline-store:sync", dashboardRefresh);

  const view = render(
    <SyncDataRefresh
      refreshRoutes={refreshRoutes}
      store={storeStub({
        onSyncStatusChange: (listener) => {
          publishStatus = listener;
          return () => {
            publishStatus = undefined;
          };
        },
      })}
    />,
  );

  await act(async () => {
    publishStatus?.(status("syncing", null));
    publishStatus?.(status("live", 1_000));
  });

  expect(refreshRoutes).toHaveBeenCalledOnce();
  expect(dashboardRefresh).toHaveBeenCalledOnce();

  await act(async () => {
    publishStatus?.(status("live", 1_000));
    publishStatus?.(status("syncing", 1_000));
    publishStatus?.(status("live", 1_000));
  });

  expect(refreshRoutes).toHaveBeenCalledTimes(2);
  expect(dashboardRefresh).toHaveBeenCalledTimes(2);

  view.unmount();
  expect(publishStatus).toBeUndefined();
  window.removeEventListener("offline-store:sync", dashboardRefresh);
});
