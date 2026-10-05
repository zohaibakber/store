import type { CatalogLifetime } from "@store/inventory-react";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { Suspense } from "react";

import { AppLoading } from "@/components/app/loading";
import { NotFound } from "@/components/app/not-found";
import { ToastProvider } from "@/components/ui/toast";
import { useAppUpdater } from "@/hooks/use-app-updater";
import type { HostInventory } from "@/lib/inventory/host-inventory";

interface RouterContext {
  readonly catalog: CatalogLifetime;
  readonly inventory: HostInventory;
  readonly registry: AtomRegistry.AtomRegistry;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
  staticData: { breadcrumb: "Home" },
});

function RootLayout() {
  return (
    <ToastProvider>
      <AppUpdater />
      <Suspense fallback={<AppLoading />}>
        <Outlet />
      </Suspense>
    </ToastProvider>
  );
}

function AppUpdater() {
  useAppUpdater();
  return null;
}
