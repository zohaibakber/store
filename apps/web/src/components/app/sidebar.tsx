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
import { useCatalogIsReady, useInventoryInsights } from "@store/inventory-react";
import type * as React from "react";

import { AsyncBoundary } from "@/components/app/error-boundary";
import { NavMain, type NavMainItem } from "@/components/app/nav-main";
import { NavUser } from "@/components/app/nav-user";
import { WorkspaceLogo } from "@/components/app/workspace-logo";
import { restockActionCount } from "@/components/insights/presentation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenuBadge,
  SidebarRail,
} from "@/components/ui/sidebar";
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
  },
  {
    title: "Categories",
    url: "/categories",
    icon: <HugeiconsIcon icon={TagsIcon} />,
  },
  {
    title: "Purchases",
    url: "/purchases",
    icon: <HugeiconsIcon icon={ShoppingBasket01Icon} />,
  },
  {
    title: "Suppliers",
    url: "/suppliers",
    icon: <HugeiconsIcon icon={UserMultipleIcon} />,
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
  {
    title: "Settings",
    url: "/settings",
    icon: <HugeiconsIcon icon={SettingsIcon} />,
  },
] satisfies NavMainItem[];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="-mb-2">
        <div className="flex h-8 items-center px-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <WorkspaceLogo />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
