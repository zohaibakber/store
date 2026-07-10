import { Link, useRouterState } from "@tanstack/react-router";
import { HomeIcon, SettingsIcon, StoreIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar-shell";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-provider";

const navigation = [
  { icon: HomeIcon, label: "Home", to: "/" },
  { icon: SettingsIcon, label: "Settings", to: "/settings" },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <Sidebar>
      <SidebarHeader className="h-16 justify-center px-4 py-0">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-xs">
            <StoreIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-sidebar-accent-foreground">Store</p>
            <p className="truncate text-xs text-sidebar-foreground">Desktop workspace</p>
          </div>
        </div>
      </SidebarHeader>
      <Separator className="bg-sidebar-border" />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Application</SidebarGroupLabel>
          <SidebarMenu>
            {navigation.map((item) => (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  active={pathname === item.to}
                  render={<Link to={item.to} activeOptions={{ exact: item.to === "/" }} />}
                  size={"sm"}
                >
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <Separator className="bg-sidebar-border" />
      <SidebarFooter>
        <ThemeToggle />
        <p className="px-2 text-xs text-sidebar-foreground/50">Store Electron · v0.0.0</p>
      </SidebarFooter>
    </Sidebar>
  );
}
