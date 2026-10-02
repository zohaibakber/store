import { SearchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type * as React from "react";

import { useCommandMenu } from "@/components/app/command-menu";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

function TitleBar({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header
      className={cn(
        "grid h-10 shrink-0 grid-cols-[minmax(0,1fr)_auto_1fr] items-center gap-4 border-b bg-sidebar text-sidebar-foreground [-webkit-app-region:drag] [&_a]:[-webkit-app-region:no-drag] [&_button]:[-webkit-app-region:no-drag]",
        className,
      )}
      data-slot="title-bar"
      {...props}
    />
  );
}

function TitleBarEnd({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center justify-end gap-1 pe-2", className)}
      data-slot="title-bar-end"
      {...props}
    />
  );
}

function TitleBarStart({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex min-w-0 items-center gap-2 ps-2", className)}
      data-slot="title-bar-start"
      {...props}
    />
  );
}

function TitleBarSearch() {
  const { open, preload } = useCommandMenu();
  return (
    <Button
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+K"
      className="w-96 justify-start"
      onClick={open}
      onFocus={preload}
      onPointerEnter={preload}
      size="sm"
      variant="outline"
    >
      <HugeiconsIcon aria-hidden="true" icon={SearchIcon} />
      <span className="text-muted-foreground">Search</span>
      <Kbd className="ms-auto">Ctrl+K</Kbd>
    </Button>
  );
}

export { TitleBar, TitleBarEnd, TitleBarSearch, TitleBarStart };
