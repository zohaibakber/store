import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

import { CommandMenuProvider } from "@/components/app/command-menu";
import { AppLoading } from "@/components/app/loading";
import { NotFound } from "@/components/app/not-found";
import { AppSidebar } from "@/components/app/sidebar";
import { SiteHeader } from "@/components/app/site-header";
import { CreateOrganizationPage } from "@/components/auth/create-organization-page";
import { AuthPage } from "@/components/auth/page";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppUpdater } from "@/hooks/use-app-updater";
import { useOnline } from "@/hooks/use-online";
import { AuthProvider, type InitialAuth, useAuth, type WorkspaceSnapshot } from "@/lib/auth";
import { useAuth as useClerkAuth } from "@/lib/clerk-runtime";
import { workspaceScreen } from "@/lib/clerk-session-policy";
import { clerkPublishableKey } from "@/lib/clerk-workspace";
import type { Store } from "@/lib/store";

export interface RouterContext {
  readonly store: Store;
  readonly initialAuth: InitialAuth;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
  staticData: { breadcrumb: "Home" },
});

export function RootLayout() {
  const { initialAuth } = Route.useRouteContext();
  useAppUpdater();
  return (
    <AuthProvider initial={initialAuth}>
      <ToastProvider>
        <AuthenticatedLayout />
      </ToastProvider>
    </AuthProvider>
  );
}

function AuthenticatedLayout() {
  const auth = useAuth();
  if (auth._tag === "Loading") return <AppLoading />;
  const snapshot = auth.snapshot;
  const error = auth._tag === "Error" ? auth.error : null;
  if (clerkPublishableKey) {
    return <ClerkSessionGate bridgeError={error} snapshot={snapshot} />;
  }
  return (
    <WorkspaceScreen
      bridgeError={error}
      screen={workspaceScreen({
        snapshot,
        clerkConfigured: false,
        clerkLoaded: true,
        online: true,
      })}
    />
  );
}

function ClerkSessionGate({
  bridgeError,
  snapshot,
}: {
  bridgeError: string | null;
  snapshot: WorkspaceSnapshot | null;
}) {
  const { isLoaded } = useClerkAuth();
  const online = useOnline();
  return (
    <WorkspaceScreen
      bridgeError={bridgeError}
      screen={workspaceScreen({
        snapshot,
        clerkConfigured: true,
        clerkLoaded: isLoaded,
        online,
      })}
    />
  );
}

function WorkspaceScreen({
  bridgeError,
  screen,
}: {
  bridgeError: string | null;
  screen: ReturnType<typeof workspaceScreen>;
}) {
  if (screen === "loading") return <AppLoading />;
  if (screen === "shell") return <AppShell />;
  if (screen === "create-org") return <CreateOrganizationPage />;
  return <AuthPage bridgeError={bridgeError} />;
}

function AppShell() {
  return (
    <TooltipProvider>
      <CommandMenuProvider>
        <SidebarProvider className="h-svh min-h-0 overflow-hidden">
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
