import type { WorkspaceSnapshot } from "@store/contracts";
import {
  createRootRouteWithContext,
  Navigate,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";

import { CommandMenuProvider } from "@/components/app/command-menu";
import { AppLoading } from "@/components/app/loading";
import { NotFound } from "@/components/app/not-found";
import { AppSidebar } from "@/components/app/sidebar";
import { SiteHeader } from "@/components/app/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppUpdater } from "@/hooks/use-app-updater";
import type { HostAccessPolicy } from "@/host-access";
import { AuthProvider, type InitialAuth, useAuth } from "@/lib/auth";
import type { InventoryHost } from "@/lib/inventory-host";

export interface RouterContext {
  readonly initialAuth: InitialAuth;
  /** Live session truth for beforeLoad admit — must stay in sync with AuthProvider. */
  readonly sessionSnapshot: WorkspaceSnapshot | null;
  /** Skip redirects while an authentication transition is being published. */
  readonly sessionPending: boolean;
  readonly access: HostAccessPolicy;
  readonly inventory: InventoryHost | null;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: ({ context, location }) => {
    if (context.sessionPending) return;
    const verdict = context.access.admit({
      location: { pathname: location.pathname },
      snapshot: context.sessionSnapshot,
    });
    if (verdict._tag === "Redirect") {
      throw redirect({ to: verdict.to, replace: verdict.replace });
    }
  },
  component: RootLayout,
  notFoundComponent: NotFound,
  staticData: { breadcrumb: "Home" },
});

export function RootLayout() {
  const { initialAuth } = Route.useRouteContext();
  return (
    <AuthProvider initial={initialAuth}>
      <ToastProvider>
        <AppUpdater />
        <AuthenticatedLayout />
      </ToastProvider>
    </AuthProvider>
  );
}

function AppUpdater() {
  useAppUpdater();
  return null;
}

function AuthenticatedLayout() {
  const auth = useAuth();
  const { access } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  // beforeLoad protects navigation. This render-time check also protects an
  // already-mounted route while the live auth snapshot changes underneath it.
  // Hide every scope transition so local or previous-organization rows cannot
  // remain visible while router invalidation is in flight.
  if (auth._tag === "Loading" && !auth.snapshot) return <AppLoading />;

  const verdict = access.admit({ location: { pathname }, snapshot: auth.snapshot });
  if (verdict._tag === "Redirect") {
    return <Navigate replace={verdict.replace} to={verdict.to} />;
  }
  return <AppShell />;
}

function AppShell() {
  const { access } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const chrome = access.chrome({ pathname });
  if (chrome._tag === "Bare") return <Outlet />;
  return (
    <TooltipProvider>
      <CommandMenuProvider>
        <SidebarProvider className="h-svh min-h-0 overflow-hidden" defaultOpen={false}>
          <AppSidebar />
          <SidebarInset className="min-h-0 scrollbar-none overflow-y-auto">
            <SiteHeader />
            <Outlet />
          </SidebarInset>
        </SidebarProvider>
      </CommandMenuProvider>
    </TooltipProvider>
  );
}
