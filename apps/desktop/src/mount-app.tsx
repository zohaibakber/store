import type { WorkspaceSnapshot } from "@store/contracts";
import { AtomRegistryProvider } from "@store/inventory-react";
import { RouterProvider, type RouterHistory } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import React from "react";
import { flushSync } from "react-dom";
import ReactDOM from "react-dom/client";

import { AppErrorBoundary } from "@/components/app/error-boundary";
import { WindowDragStrip } from "@/components/app/window-controls";
import { ThemeProvider } from "@/components/theme/provider";
import { appHost } from "@/host";
import type { HostAccessPolicy } from "@/host-access";
import type { HostInventory } from "@/lib/inventory/host-inventory";
import { upgradeBareThemePreference } from "@/lib/preferences";
import type { DeviceWorkspaceStore } from "@/session/device-workspace";
import { startWorkspaceSession, workspaceSessionFeed } from "@/session/workspace-session";

import { getRouter } from "./router";

export const mountApp = (input: {
  readonly snapshot: WorkspaceSnapshot;
  readonly history: RouterHistory;
  readonly access: HostAccessPolicy;
  readonly inventory: HostInventory;
  readonly device: DeviceWorkspaceStore;
}) => {
  upgradeBareThemePreference();
  const registry = AtomRegistry.make({ defaultIdleTTL: 30_000 });
  const router = getRouter({
    history: input.history,
    access: input.access,
    inventory: input.inventory,
    registry,
  });
  startWorkspaceSession(
    registry,
    {
      access: input.access,
      device: input.device,
      bridge: appHost().auth,
      invalidate: Effect.ignore(Effect.tryPromise(() => router.invalidate())),
      flush: flushSync,
    },
    input.snapshot,
  );
  if (input.inventory._tag === "Replica") registry.mount(input.inventory.catalogs.held);
  registry.mount(workspaceSessionFeed);
  const app = <RouterProvider router={router} />;
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppErrorBoundary
        fallback={
          <main className="relative min-h-svh pt-10">
            <WindowDragStrip />
            <p className="p-4 text-sm">The app hit an unexpected error. Reopen it to try again.</p>
          </main>
        }
      >
        <AtomRegistryProvider registry={registry}>
          <ThemeProvider>{app}</ThemeProvider>
        </AtomRegistryProvider>
      </AppErrorBoundary>
    </React.StrictMode>,
  );
};
