import { ArrowRight01Icon, PlusSignCircleIcon, SearchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";

import { useCommandMenu } from "@/components/app/command-menu";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Kbd } from "@/components/ui/kbd";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
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
  | "/products/categories"
  | "/purchases"
  | "/purchases/suppliers"
  | "/invoices";

type NavSubItem = {
  title: string;
  url: AppRoute;
  icon: React.ReactNode;
};

export type NavMainItem = {
  title: string;
  url: AppRoute;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  items?: ReadonlyArray<NavSubItem>;
};

const isWithin = (pathname: string, url: string) =>
  url === "/" ? pathname === "/" : pathname === url || pathname.startsWith(`${url}/`);

export function NavMain({ items }: { items: NavMainItem[] }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const { open: openCommandMenu, preload: preloadCommandMenu } = useCommandMenu();
  const newSaleShortcut = appHost().newSaleShortcut;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const parkedSales = useParkedSaleCountIn(useWorkspaceStorageKey(), pathname === "/invoices/new");
  const parkedLabel = `${formatCount(parkedSales, "sale")} in progress`;
  const isActive = (item: NavMainItem) =>
    isWithin(pathname, item.url) && !(item.items ?? []).some((sub) => isWithin(pathname, sub.url));

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
                <Kbd>{newSaleShortcut.label}</Kbd>
              </span>
            </SidebarMenuBadge>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Search"
              aria-keyshortcuts="Control+K"
              aria-haspopup="dialog"
              onClick={openCommandMenu}
              onFocus={preloadCommandMenu}
              onPointerEnter={preloadCommandMenu}
            >
              <HugeiconsIcon icon={SearchIcon} />
              <span>Search</span>
            </SidebarMenuButton>
            <SidebarMenuBadge>
              <Kbd>Ctrl+K</Kbd>
            </SidebarMenuBadge>
          </SidebarMenuItem>
          {items.map((item) => {
            const button = (
              <SidebarMenuButton
                isActive={isActive(item)}
                tooltip={item.title}
                render={<Link to={item.url} onClick={closeMobileSidebar} />}
              >
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
            );
            if (!item.items || item.items.length === 0) {
              return (
                <SidebarMenuItem key={item.title}>
                  {button}
                  {item.badge}
                </SidebarMenuItem>
              );
            }
            return (
              <NavCollapsible
                key={item.title}
                forceOpen={item.items.some((sub) => isWithin(pathname, sub.url))}
              >
                {button}
                <CollapsibleTrigger
                  render={<SidebarMenuAction aria-label={`Toggle ${item.title} submenu`} />}
                >
                  <HugeiconsIcon
                    aria-hidden="true"
                    className="transition-transform in-data-panel-open:rotate-90"
                    icon={ArrowRight01Icon}
                  />
                </CollapsibleTrigger>
                <CollapsiblePanel>
                  <SidebarMenuSub>
                    {item.items.map((sub) => (
                      <SidebarMenuSubItem key={sub.url}>
                        <SidebarMenuSubButton
                          isActive={isWithin(pathname, sub.url)}
                          render={<Link to={sub.url} onClick={closeMobileSidebar} />}
                        >
                          {sub.icon}
                          <span>{sub.title}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsiblePanel>
              </NavCollapsible>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function NavCollapsible({
  children,
  forceOpen,
}: {
  readonly children: React.ReactNode;
  readonly forceOpen: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Collapsible onOpenChange={setOpen} open={open || forceOpen} render={<SidebarMenuItem />}>
      {children}
    </Collapsible>
  );
}
