import { PanelLeftIcon } from "lucide-react";
import * as React from "react";
import { useIsMobile } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";

type SidebarContextValue = {
  isMobile: boolean;
  mobileOpen: boolean;
  open: boolean;
  setMobileOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toggle: () => void;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

function useSidebarContext() {
  const context = React.useContext(SidebarContext);
  if (!context) throw new Error("Sidebar components must be inside SidebarProvider.");
  return context;
}

export function SidebarProvider({
  children,
  className,
  defaultOpen = true,
  ...props
}: React.ComponentProps<"div"> & { defaultOpen?: boolean }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(defaultOpen);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const toggle = React.useCallback(() => {
    if (isMobile) setMobileOpen((current) => !current);
    else setOpen((current) => !current);
  }, [isMobile]);

  const value = React.useMemo(
    () => ({ isMobile, mobileOpen, open, setMobileOpen, setOpen, toggle }),
    [isMobile, mobileOpen, open, toggle],
  );

  return (
    <SidebarContext.Provider value={value}>
      <div
        data-slot="sidebar-wrapper"
        className={cn("flex min-h-svh w-full bg-background", className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({ children }: { children: React.ReactNode }) {
  const { isMobile, mobileOpen, open, setMobileOpen } = useSidebarContext();

  if (isMobile) {
    return (
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetPopup
          id="app-sidebar"
          side="left"
          showCloseButton={false}
          className="w-72 max-w-72 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </SheetPopup>
      </Sheet>
    );
  }

  return (
    <div
      data-slot="sidebar"
      data-state={open ? "expanded" : "collapsed"}
      className={cn(
        "relative shrink-0 transition-[width] duration-200 ease-linear",
        open ? "w-64" : "w-0",
      )}
    >
      <aside
        id="app-sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-200 ease-linear",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {children}
      </aside>
    </div>
  );
}

export function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn("flex shrink-0 flex-col gap-2 p-3", className)}
      {...props}
    />
  );
}

export function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="sidebar-content" className="min-h-0 flex-1">
      <ScrollArea fill scrollFade>
        <div className={cn("p-3", className)} {...props} />
      </ScrollArea>
    </div>
  );
}

export function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn("flex shrink-0 flex-col p-3", className)}
      {...props}
    />
  );
}

export function SidebarGroup({ className, ...props }: React.ComponentProps<"section">) {
  return <section data-slot="sidebar-group" className={cn("space-y-2", className)} {...props} />;
}

export function SidebarGroupLabel({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="sidebar-group-label"
      className={cn("px-2 text-xs font-medium text-sidebar-foreground/50", className)}
      {...props}
    />
  );
}

export function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul data-slot="sidebar-menu" className={cn("space-y-1", className)} {...props} />;
}

export function SidebarMenuItem(props: React.ComponentProps<"li">) {
  return <li data-slot="sidebar-menu-item" {...props} />;
}

export function SidebarMenuButton({
  active = false,
  size = "default",
  className,
  ...props
}: React.ComponentProps<typeof Button> & { active?: boolean }) {
  const { isMobile, setMobileOpen } = useSidebarContext();

  return (
    <Button
      data-active={active || undefined}
      data-slot="sidebar-menu-button"
      variant="ghost"
      className={cn(
        "w-full justify-start border-transparent px-3 text-sidebar-foreground shadow-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground",
        className,
      )}
      onClick={() => {
        if (isMobile) setMobileOpen(false);
      }}
      size={size}
      {...props}
    />
  );
}

export function SidebarTrigger({ className, ...props }: React.ComponentProps<typeof Button>) {
  const { isMobile, mobileOpen, open, toggle } = useSidebarContext();
  const expanded = isMobile ? mobileOpen : open;

  return (
    <Button
      aria-controls="app-sidebar"
      aria-expanded={expanded}
      aria-label={expanded ? "Close sidebar" : "Open sidebar"}
      data-slot="sidebar-trigger"
      size="icon"
      variant="ghost"
      className={className}
      onClick={toggle}
      {...props}
    >
      <PanelLeftIcon />
    </Button>
  );
}

export function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn("min-h-svh min-w-0 flex-1 bg-background", className)}
      {...props}
    />
  );
}
