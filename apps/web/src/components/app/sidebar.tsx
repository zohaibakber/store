import {
  PackageIcon,
  HomeIcon,
  Invoice01Icon,
  SettingsIcon,
  ShoppingBasket01Icon,
  TagIcon,
  TagsIcon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import type * as React from "react";

import { AsyncBoundary } from "@/components/app/error-boundary";
import { NavHistory } from "@/components/app/nav-history";
import { NavMain, type NavMainItem } from "@/components/app/nav-main";
import { NavUser } from "@/components/app/nav-user";
import { WorkspaceLogo } from "@/components/app/workspace-logo";
import { restockActionCount } from "@/components/insights/presentation";
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
import { useFirstSyncPending } from "@/lib/inventory/provider";

function RestockCountReady() {
  const counts = useInventoryInsights().summary?.counts;
  const count = counts === undefined ? 0 : restockActionCount(counts);
  if (count === 0) return null;
  return (
    <SidebarMenuBadge aria-label={`${count} products need restocking`}>
      <span className="tabular-nums">{count > 99 ? "99+" : count}</span>
    </SidebarMenuBadge>
  );
}

function RestockCount() {
  if (!useCatalogIsReady()) return null;
  return <RestockCountSynced />;
}

function RestockCountSynced() {
  if (useFirstSyncPending()) return null;
  return (
    <AsyncBoundary fallback={null}>
      <RestockCountReady />
    </AsyncBoundary>
  );
}

const navMain = [
  {
    title: "Home",
    url: "/",
    icon: <HugeiconsIcon icon={HomeIcon} />,
  },
  {
    title: "Products",
    url: "/products",
    icon: <HugeiconsIcon icon={TagIcon} />,
    items: [
      {
        title: "Categories",
        url: "/products/categories",
        icon: <HugeiconsIcon icon={TagsIcon} />,
      },
    ],
  },
  {
    title: "Purchases",
    url: "/purchases",
    icon: <HugeiconsIcon icon={ShoppingBasket01Icon} />,
    items: [
      {
        title: "Suppliers",
        url: "/purchases/suppliers",
        icon: <HugeiconsIcon icon={UserMultipleIcon} />,
      },
    ],
  },
  {
    title: "Restock",
    url: "/restock",
    icon: <HugeiconsIcon icon={PackageIcon} />,
    badge: <RestockCount />,
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
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
