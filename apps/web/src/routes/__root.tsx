import type { CatalogLifetime, InventoryHost } from "@store/inventory-react";
import { createRootRouteWithContext, Outlet, redirect } from "@tanstack/react-router";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { Suspense } from "react";

import { AppLoading } from "@/components/app/loading";
import { NotFound } from "@/components/app/not-found";
import { ToastProvider } from "@/components/ui/toast";
import { useAppUpdater } from "@/hooks/use-app-updater";
import type { HostAccessPolicy } from "@/host-access";
import type { ReplayChannel } from "@/host/replay-channel";
import { AuthProvider, useAuth } from "@/lib/auth";
import { publishedWorkspaceSnapshot, type WorkspaceSession } from "@/session/workspace-session";

interface RouterContext {
  readonly session: ReplayChannel<WorkspaceSession>;
  readonly catalog: CatalogLifetime;
  readonly access: HostAccessPolicy;
  readonly inventory: InventoryHost | null;
  readonly registry: AtomRegistry.AtomRegistry;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: ({ context, location }) => {
    const snapshot = publishedWorkspaceSnapshot(context.session.current());
    const verdict = context.access.admit({
      location: { pathname: location.pathname },
      snapshot,
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
  return (
    <AuthProvider>
      <ToastProvider>
        <AppUpdater />
        <Screen />
      </ToastProvider>
    </AuthProvider>
  );
}

function AppUpdater() {
  useAppUpdater();
  return null;
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
