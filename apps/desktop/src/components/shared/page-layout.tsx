import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageWidth = "full" | "narrow";

const widthClassNames = {
  full: "",
  narrow: "mx-auto max-w-3xl",
} as const satisfies Record<PageWidth, string>;

function PageLayout({
  children,
  className,
  contentClassName,
  width = "full",
  ...props
}: ComponentProps<"div"> & {
  children: ReactNode;
  contentClassName?: string;
  width?: PageWidth;
}) {
  return (
    <div data-slot="page-layout" className={cn("p-4 pt-2", className)} {...props}>
      <div
        data-slot="page-layout-content"
        className={cn("flex w-full flex-col gap-4", widthClassNames[width], contentClassName)}
      >
        {children}
      </div>
    </div>
  );
}

function PageContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="page-content" className={cn("flex flex-col gap-4", className)} {...props} />
  );
}

function PageHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      data-slot="page-header"
      className={cn(
        "grid auto-rows-min items-center gap-x-4 gap-y-1 empty:hidden has-data-[slot=page-action]:grid-cols-[minmax(0,1fr)_auto] has-data-[slot=page-description]:*:data-[slot=page-action]:row-end-3",
        className,
      )}
      {...props}
    />
  );
}

function PageHeading({ className, ...props }: ComponentProps<"h1">) {
  return (
    <h1
      data-slot="page-heading"
      className={cn("truncate text-lg leading-tight font-medium", className)}
      {...props}
    />
  );
}

function PageDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="page-description"
      className={cn("text-sm text-muted-foreground tabular-nums", className)}
      {...props}
    />
  );
}

function PageAction({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="page-action"
      className={cn("col-start-2 row-start-1 flex items-center gap-2 justify-self-end", className)}
      {...props}
    />
  );
}

export { PageAction, PageContent, PageDescription, PageHeader, PageHeading, PageLayout };
