import { PlusSignCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useRouterState } from "@tanstack/react-router";

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
import { useParkedSaleCountIn } from "@/hooks/use-sale-drafts";
import { appHost } from "@/host";
import { formatCount } from "@/lib/format";
import { useWorkspaceStorageKey } from "@/lib/workspace";

type AppRoute =
  | "/"
  | "/restock"
  | "/products"
  | "/categories"
  | "/purchases"
  | "/suppliers"
  | "/invoices"
  | "/settings";

export type NavMainItem = {
  title: string;
  url: AppRoute;
  icon: React.ReactNode;
  badge?: React.ReactNode;
};

const isWithin = (pathname: string, url: string) =>
  url === "/" ? pathname === "/" : pathname === url || pathname.startsWith(`${url}/`);

export function NavMain({ items }: { items: NavMainItem[] }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const newSaleShortcut = appHost().newSaleShortcut;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const parkedSales = useParkedSaleCountIn(useWorkspaceStorageKey(), pathname === "/invoices/new");
  const parkedLabel = `${formatCount(parkedSales, "sale")} in progress`;

  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };

  useNewSaleShortcut();

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem className="-mb-0.5">
            <SidebarMenuButton
              className="hover:bg-transparent"
              tooltip={parkedSales > 0 ? `New Sale · ${parkedLabel}` : "New Sale"}
              aria-keyshortcuts={newSaleShortcut.ariaKeyShortcuts}
              render={<Link to="/invoices/new" onClick={closeMobileSidebar} />}
            >
              <HugeiconsIcon icon={PlusSignCircleIcon} />
              <span>New Sale</span>
            </SidebarMenuButton>
            {parkedSales > 0 && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1 right-1 hidden size-2 rounded-full bg-primary group-data-[collapsible=icon]:block"
              />
            )}
            <SidebarMenuBadge>
              <span className="flex items-center gap-1.5">
                {parkedSales > 0 && (
                  <span aria-label={parkedLabel} className="tabular-nums">
                    {parkedSales}
                  </span>
                )}
                <span className="opacity-0 transition-opacity group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100">
                  <Kbd>{newSaleShortcut.label}</Kbd>
                </span>
              </span>
            </SidebarMenuBadge>
          </SidebarMenuItem>
          {items.map((item) => (
            <SidebarMenuItem className="-mb-0.5" key={item.title}>
              <SidebarMenuButton
                className="hover:bg-transparent"
                isActive={isWithin(pathname, item.url)}
                tooltip={item.title}
                render={<Link to={item.url} onClick={closeMobileSidebar} />}
              >
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
              {item.badge}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
