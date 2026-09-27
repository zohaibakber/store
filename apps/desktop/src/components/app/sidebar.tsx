import {
  DeliveryTruck01Icon,
  HomeIcon,
  Invoice01Icon,
  SettingsIcon,
  TagIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { Suspense } from "react";
import type * as React from "react";

import { AppErrorBoundary } from "@/components/app/error-boundary";
import { NavHistory } from "@/components/app/nav-history";
import { NavMain, type NavMainItem } from "@/components/app/nav-main";
import { WorkspaceLogo } from "@/components/app/workspace-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useCatalogIsReady, useInventoryInsights } from "@/lib/inventory";

function RestockCountReady() {
  const { out, critical, low } = useInventoryInsights().report.counts;
  const count = out + critical + low;
  if (count === 0) return null;
  return (
    <SidebarMenuBadge aria-label={`${count} products need restocking`}>
      <span className="tabular-nums">{count > 99 ? "99+" : count}</span>
    </SidebarMenuBadge>
  );
}

function RestockCount() {
  if (!useCatalogIsReady()) return null;
  return (
    <AppErrorBoundary fallback={null}>
      <Suspense fallback={null}>
        <RestockCountReady />
      </Suspense>
    </AppErrorBoundary>
  );
}

const navMain = [
  {
    title: "Home",
    url: "/",
    icon: <HugeiconsIcon icon={HomeIcon} />,
  },
  {
    title: "Restock",
    url: "/restock",
    icon: <HugeiconsIcon icon={DeliveryTruck01Icon} />,
    badge: <RestockCount />,
  },
  {
    title: "Products",
    url: "/products",
    icon: <HugeiconsIcon icon={TagIcon} />,
  },
  {
    title: "Invoices",
    url: "/invoices",
    icon: <HugeiconsIcon icon={Invoice01Icon} />,
  },
] satisfies NavMainItem[];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <div className="flex items-center justify-between group-data-[collapsible=icon]:justify-center">
          <WorkspaceLogo />
          <NavHistory className="group-data-[collapsible=icon]:hidden" />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Settings"
              render={<Link activeProps={{ "data-active": true }} to="/settings" />}
            >
              <HugeiconsIcon icon={SettingsIcon} />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
