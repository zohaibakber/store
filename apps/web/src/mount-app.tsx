import type { WorkspaceSnapshot } from "@store/contracts";
import { RouterProvider, type RouterHistory } from "@tanstack/react-router";
import React from "react";
import { flushSync } from "react-dom";
import ReactDOM from "react-dom/client";

import { ThemeProvider } from "@/components/theme/provider";
import type { HostAccessPolicy } from "@/host-access";
import { authSession } from "@/lib/auth";
import type { InventoryHost } from "@/lib/inventory-host";
import { createAppCatalogLifetime } from "@/lib/inventory/lifetime";
import { Sentry } from "@/lib/sentry";
import { makeReplayChannel } from "@/replay-channel";
import { bindWorkspaceSession, type WorkspaceSession } from "@/session/workspace-session";

import { getRouter } from "./router";

export const mountApp = (input: {
  readonly snapshot: WorkspaceSnapshot;
  readonly history: RouterHistory;
  readonly access: HostAccessPolicy;
  readonly inventory?: InventoryHost;
}) => {
  const session = makeReplayChannel<WorkspaceSession>();
  session.publish({ _tag: "Steady", snapshot: input.snapshot });
  const catalog = createAppCatalogLifetime();
  const scope = input.access.inventoryScope(input.snapshot);
  if (scope) catalog.claim(scope);

  const router = getRouter({
    history: input.history,
    session,
    catalog,
    access: input.access,
    inventory: input.inventory,
  });
  bindWorkspaceSession({
    session,
    catalog,
    access: input.access,
    bridge: authSession(),
    invalidate: () => router.invalidate().then(() => undefined),
    flush: flushSync,
  });
  const app = <RouterProvider router={router} />;
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <Sentry.ErrorBoundary
        fallback={
          <p className="p-4 text-sm">The app hit an unexpected error. Reopen it to try again.</p>
        }
      >
        <ThemeProvider>{app}</ThemeProvider>
      </Sentry.ErrorBoundary>
    </React.StrictMode>,
  );
};
