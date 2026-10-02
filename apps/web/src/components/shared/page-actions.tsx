import { createContext, use, useState } from "react";
import type * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

interface PageActionsTarget {
  readonly target: HTMLElement | null;
  readonly setTarget: (element: HTMLElement | null) => void;
}

const PageActionsContext = createContext<PageActionsTarget | null>(null);

function PageActionsProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  return <PageActionsContext value={{ target, setTarget }}>{children}</PageActionsContext>;
}

function PageActionsSlot({ className, ...props }: Omit<React.ComponentProps<"div">, "ref">) {
  const context = use(PageActionsContext);
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 [-webkit-app-region:no-drag] empty:hidden",
        className,
      )}
      data-slot="page-actions-slot"
      ref={context?.setTarget}
      {...props}
    />
  );
}

function PageActions({ className, ...props }: React.ComponentProps<"div">) {
  const target = use(PageActionsContext)?.target;
  if (!target) return null;
  return createPortal(
    <div
      className={cn("flex min-w-0 items-center gap-2", className)}
      data-slot="page-actions"
      {...props}
    />,
    target,
  );
}

export { PageActions, PageActionsProvider, PageActionsSlot };
