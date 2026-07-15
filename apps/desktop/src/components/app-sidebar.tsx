import * as React from "react";

import { NavMain, type NavMainItem } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { SyncButton } from "@/components/sync-button";
import { TeamSwitcher } from "@/components/team-switcher";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import { HugeiconsIcon } from "@hugeicons/react";
import { HomeIcon, Invoice01Icon, SettingsIcon, TagIcon } from "@hugeicons/core-free-icons";
import { SearchForm } from "./search-form";

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
    <Sidebar variant="inset" collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <TeamSwitcher />
        <SearchForm />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <NavUser />
          </div>
          <SyncButton />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
