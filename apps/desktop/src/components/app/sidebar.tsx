import { HomeIcon, Invoice01Icon, SettingsIcon, TagIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type * as React from "react";

import { AccountMenu } from "@/components/app/account-menu";
import { NavHistory } from "@/components/app/nav-history";
import { NavMain, type NavMainItem } from "@/components/app/nav-main";
import { SearchForm } from "@/components/app/search-form";
import { SyncStatusIndicator } from "@/components/app/sync-status";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const data = {
  navMain: [
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
      title: "Invoices",
      url: "/invoices",
      icon: <HugeiconsIcon icon={Invoice01Icon} />,
    },
    {
      title: "Settings",
      url: "/settings",
      icon: <HugeiconsIcon icon={SettingsIcon} />,
    },
  ] satisfies NavMainItem[],
};
export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" variant="inset" {...props}>
      <SidebarHeader>
        <div className="-mx-1 flex items-center gap-1 group-data-[collapsible=icon]:mx-0 group-data-[collapsible=icon]:justify-center">
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <AccountMenu />
          </div>
          <SidebarTrigger className="shrink-0" />
        </div>
        <div className="group-data-[collapsible=icon]:hidden">
          <SearchForm />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center justify-between gap-2 px-1">
          <SyncStatusIndicator />
          <div className="group-data-[collapsible=icon]:hidden">
            <NavHistory />
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
