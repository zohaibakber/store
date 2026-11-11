import { init } from "@sentry/electron/renderer";
import { init as reactInit } from "@sentry/react";
import { createHashHistory, RouterProvider } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import React from "react";
import { flushSync } from "react-dom";
import ReactDOM from "react-dom/client";

import { AppErrorBoundary } from "@/components/app/error-boundary";
import { WindowDragStrip } from "@/components/app/window-controls";
import { ThemeSync } from "@/components/theme/provider";
import { hostAccess } from "@/host-access";
import { makeCatalogs } from "@/inventory/opening";
import { browserStorage } from "@/inventory/preferences";
import { AtomRegistryProvider } from "@/inventory/provider";
import { bootstrapAuth } from "@/lib/auth";
import { deviceWorkspaceStore } from "@/session/device-workspace";
import { startWorkspaceSession, workspaceSessionFeed } from "@/session/workspace-session";

import { getRouter } from "./router";

export const startApp = async () => {
  if (__SENTRY_DSN__) init({}, reactInit);
  const device = deviceWorkspaceStore(browserStorage());
  const access = hostAccess(device);
  const inventory = makeCatalogs();
  const snapshot = await bootstrapAuth();
  const registry = AtomRegistry.make({ defaultIdleTTL: 30_000 });
  const router = getRouter({
    history: createHashHistory(),
    access,
    inventory,
    registry,
  });
  startWorkspaceSession(
    registry,
    {
      access,
      device,
      invalidate: Effect.ignore(Effect.tryPromise(() => router.invalidate())),
      flush: flushSync,
    },
    snapshot,
  );
  registry.mount(inventory.held);
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
          {app}
          <ThemeSync />
        </AtomRegistryProvider>
      </AppErrorBoundary>
    </React.StrictMode>,
  );
};
