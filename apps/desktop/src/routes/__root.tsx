import { createRootRouteWithContext, Outlet, redirect } from "@tanstack/react-router";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { Suspense } from "react";

import { AppLoading } from "@/components/app/loading";
import { NotFound } from "@/components/app/not-found";
import { ToastProvider } from "@/components/ui/toast";
import { useAppUpdater } from "@/hooks/use-app-updater";
import type { HostAccessPolicy } from "@/host-access";
import { AuthProvider, useAuth } from "@/lib/auth";
import type { HostInventory } from "@/lib/inventory/host-inventory";
import { workspaceSessionAtom } from "@/session/workspace-session";

interface RouterContext {
  readonly access: HostAccessPolicy;
  readonly inventory: HostInventory;
  readonly registry: AtomRegistry.AtomRegistry;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: ({ context, location }) => {
    const verdict = context.access.admit({
      location: { pathname: location.pathname },
      snapshot: context.registry.get(workspaceSessionAtom).snapshot,
    });
    if (verdict._tag === "Redirect") {
      throw redirect({ to: verdict.to, replace: verdict.replace });
    }
  },
  component: RootLayout,
  notFoundComponent: NotFound,
  staticData: { breadcrumb: "Home" },
});

function RootLayout() {
  useAppUpdater();
  return (
    <AuthProvider>
      <ToastProvider>
        <Screen />
      </ToastProvider>
    </AuthProvider>
  );
}

function Screen() {
  const auth = useAuth();
  if (auth._tag === "Loading") return <AppLoading />;
  return (
    <Suspense fallback={<AppLoading />}>
      <Outlet />
    </Suspense>
  );
}
