import {
  HomeIcon,
  Invoice01Icon,
  SearchIcon,
  SettingsIcon,
  TagIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type * as React from "react";

import { AccountMenu } from "@/components/app/account-menu";
import { useCommandMenu } from "@/components/app/command-menu";
import { NavHistory } from "@/components/app/nav-history";
import { NavMain, type NavMainItem } from "@/components/app/nav-main";
import { SyncStatusIndicator } from "@/components/app/sync-status";
import { Kbd } from "@/components/ui/kbd";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
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
  const { open: openCommandMenu } = useCommandMenu();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <div className="-mx-1 flex items-center gap-1 group-data-[collapsible=icon]:mx-0 group-data-[collapsible=icon]:justify-center">
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <AccountMenu />
          </div>
          <SidebarTrigger className="shrink-0" />
        </div>
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Search"
                  aria-keyshortcuts="Control+K"
                  aria-haspopup="dialog"
                  onClick={openCommandMenu}
                >
                  <HugeiconsIcon icon={SearchIcon} />
                  <span>Search</span>
                </SidebarMenuButton>
                <SidebarMenuBadge>
                  <Kbd>Ctrl K</Kbd>
                </SidebarMenuBadge>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
