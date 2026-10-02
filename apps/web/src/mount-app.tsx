import { RegistryContext } from "@effect/atom-react";
import type { WorkspaceSnapshot } from "@store/contracts";
import {
  configureInventoryPreferences,
  type CatalogLifetime,
  type InventoryHost,
} from "@store/inventory-react";
import { RouterProvider, type RouterHistory } from "@tanstack/react-router";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import React from "react";
import { flushSync } from "react-dom";
import ReactDOM from "react-dom/client";

import { AppErrorBoundary } from "@/components/app/error-boundary";
import { ThemeProvider } from "@/components/theme/provider";
import type { HostAccessPolicy } from "@/host-access";
import { makeReplayChannel } from "@/host/replay-channel";
import { authSession } from "@/lib/auth";
import { preferenceStore } from "@/lib/preferences";
import type { DeviceWorkspaceStore } from "@/session/device-workspace";
import {
  bindWorkspaceSession,
  startWorkspaceSession,
  type WorkspaceSession,
} from "@/session/workspace-session";

import { getRouter } from "./router";

export const mountApp = (input: {
  readonly snapshot: WorkspaceSnapshot;
  readonly history: RouterHistory;
  readonly access: HostAccessPolicy;
  readonly catalog: CatalogLifetime;
  readonly inventory?: InventoryHost;
  readonly device?: DeviceWorkspaceStore;
}) => {
  configureInventoryPreferences(preferenceStore());
  const session = makeReplayChannel<WorkspaceSession>();
  const { catalog } = input;
  const workspace = { session, catalog, access: input.access, device: input.device };
  startWorkspaceSession(workspace, input.snapshot);

  const registry = AtomRegistry.make({ defaultIdleTTL: 30_000 });
  const router = getRouter({
    history: input.history,
    session,
    catalog,
    access: input.access,
    inventory: input.inventory,
    registry,
  });
  bindWorkspaceSession({
    ...workspace,
    bridge: authSession(),
    invalidate: () => router.invalidate().then(() => undefined),
    flush: flushSync,
  });
  const app = <RouterProvider router={router} />;
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppErrorBoundary
        fallback={
          <p className="p-4 text-sm">The app hit an unexpected error. Reopen it to try again.</p>
        }
      >
        <RegistryContext.Provider value={registry}>
          <ThemeProvider>{app}</ThemeProvider>
        </RegistryContext.Provider>
      </AppErrorBoundary>
    </React.StrictMode>,
  );
};
