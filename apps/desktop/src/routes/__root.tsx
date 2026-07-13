import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppSidebar } from "@/components/app-sidebar";
import { NotFound } from "@/components/not-found";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AuthPage } from "@/components/auth-page";
import { CreateOrganizationPage } from "@/components/create-organization-page";
import { AuthProvider, useAuth } from "@/lib/auth";

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});

export function RootLayout() {
  return (
    <AuthProvider>
      <AuthenticatedLayout />
    </AuthProvider>
  );
}

function AuthenticatedLayout() {
  const { snapshot, error } = useAuth();
  if (!snapshot || snapshot.status === "unauthenticated") return <AuthPage bridgeError={error} />;
  if (!snapshot.activeOrganization) return <CreateOrganizationPage />;
  return (
    <TooltipProvider>
      <div className="[--footer-height:calc(--spacing(8))] [--header-height:calc(--spacing(10))]">
        <SidebarProvider className="h-svh flex flex-col overflow-hidden">
          <SiteHeader />
          <div className="flex min-h-0 flex-1">
            <AppSidebar />
            <SidebarInset className="min-h-0 overflow-y-auto scrollbar-gutter-stable [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-button]:h-0 [&::-webkit-scrollbar-button]:w-0 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40">
              <Outlet />
              <Toaster />
            </SidebarInset>
          </div>
          <SiteFooter />
        </SidebarProvider>
      </div>
    </TooltipProvider>
  );
}
