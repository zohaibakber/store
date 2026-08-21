import type { WorkspaceSnapshot } from "@store/contracts";
import {
  createRootRouteWithContext,
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
import type { Store } from "@/lib/store";

export interface RouterContext {
  readonly store: Store;
  readonly initialAuth: InitialAuth;
  /** Live session truth for beforeLoad admit — must stay in sync with AuthProvider. */
  readonly sessionSnapshot: WorkspaceSnapshot | null;
  /**
   * Cold-start: OfflineStore still opening. Skip admit redirects so a signed-in
   * cookie session is not bounced to /sign-in before the snapshot publishes.
   */
  readonly sessionPending: boolean;
  readonly access: HostAccessPolicy;
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
  if (auth._tag === "Loading" && !auth.snapshot) return <AppLoading />;
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
