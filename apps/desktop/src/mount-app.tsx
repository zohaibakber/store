import { RegistryContext } from "@effect/atom-react";
import { configureInventoryPreferences, type CatalogLifetime } from "@store/inventory-react";
import { RouterProvider, type RouterHistory } from "@tanstack/react-router";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import React from "react";
import ReactDOM from "react-dom/client";

import { AppErrorBoundary } from "@/components/app/error-boundary";
import { WindowDragStrip } from "@/components/app/window-controls";
import { ThemeProvider } from "@/components/theme/provider";
import type { HostInventory } from "@/lib/inventory/host-inventory";
import { preferenceStore } from "@/lib/preferences";

import { getRouter } from "./router";

export const mountApp = (input: {
  readonly history: RouterHistory;
  readonly catalog: CatalogLifetime;
  readonly inventory: HostInventory;
}) => {
  configureInventoryPreferences(preferenceStore());
  const registry = AtomRegistry.make({ defaultIdleTTL: 30_000 });
  const router = getRouter({
    history: input.history,
    catalog: input.catalog,
    inventory: input.inventory,
    registry,
  });
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
        <RegistryContext.Provider value={registry}>
          <ThemeProvider>{app}</ThemeProvider>
        </RegistryContext.Provider>
      </AppErrorBoundary>
    </React.StrictMode>,
  );
};
