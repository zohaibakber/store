import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppSidebar } from "@/components/app-sidebar";
import { NotFound } from "@/components/not-found";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar-shell";
import { WindowControls } from "@/components/window-controls";

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});

export function RootLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="window-drag-region sticky top-0 z-30 flex h-10 items-center gap-3 border-b bg-background/90 pl-4 backdrop-blur">
          <SidebarTrigger className="window-no-drag -ml-1" />
          <WindowControls />
        </header>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
