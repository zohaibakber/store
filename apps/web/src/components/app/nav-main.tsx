import { PlusSignCircleIcon, SearchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

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

type AppRoute = "/" | "/products" | "/invoices";

export type NavMainItem = {
  title: string;
  url: AppRoute;
  icon: React.ReactNode;
};

export function NavMain({ items }: { items: NavMainItem[] }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const { open: openCommandMenu } = useCommandMenu();
  const navigate = useNavigate();

  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "n" && event.key !== "N") return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;

      event.preventDefault();
      if (isMobile) setOpenMobile(false);
      void navigate({ to: "/invoices/new" });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isMobile, navigate, setOpenMobile]);

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
