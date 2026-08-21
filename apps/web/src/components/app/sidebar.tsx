import {
  BubbleChatIcon,
  HomeIcon,
  Invoice01Icon,
  SettingsIcon,
  TagIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import type * as React from "react";

import { NavHistory } from "@/components/app/nav-history";
import { NavMain, type NavMainItem } from "@/components/app/nav-main";
import { WorkspaceLogo } from "@/components/app/workspace-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

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
    title: "Invoices",
    url: "/invoices",
    icon: <HugeiconsIcon icon={Invoice01Icon} />,
  },
] satisfies NavMainItem[];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <div className="flex items-center justify-between gap-1 group-data-[collapsible=icon]:justify-center">
          <WorkspaceLogo className="group-data-[collapsible=icon]:hidden" />
          <NavHistory className="group-data-[collapsible=icon]:flex-col" />
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
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Feedback"
              render={<a href="#" onClick={(event) => event.preventDefault()} />}
            >
              <HugeiconsIcon icon={BubbleChatIcon} />
              <span>Feedback</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
