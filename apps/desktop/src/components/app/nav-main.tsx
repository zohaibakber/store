import { PlusSignCircleIcon, SearchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { useCommandMenu } from "@/components/app/command-menu";
import { Kbd } from "@/components/ui/kbd";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useNewSaleShortcut } from "@/hooks/use-new-sale-shortcut";

type AppRoute = "/" | "/products" | "/invoices";

export type NavMainItem = {
  title: string;
  url: AppRoute;
  icon: React.ReactNode;
};

export function NavMain({ items }: { items: NavMainItem[] }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const { open: openCommandMenu } = useCommandMenu();

  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };

  useNewSaleShortcut();

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="New Sale"
              aria-keyshortcuts="Control+N"
              render={<Link to="/invoices/new" onClick={closeMobileSidebar} />}
            >
              <HugeiconsIcon icon={PlusSignCircleIcon} />
              <span>New Sale</span>
            </SidebarMenuButton>
            <SidebarMenuBadge>
              <Kbd>Ctrl+N</Kbd>
            </SidebarMenuBadge>
          </SidebarMenuItem>
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
              <Kbd>Ctrl+K</Kbd>
            </SidebarMenuBadge>
          </SidebarMenuItem>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                render={
                  <Link
                    activeProps={{ "data-active": true }}
                    to={item.url}
                    onClick={closeMobileSidebar}
                  />
                }
              >
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
