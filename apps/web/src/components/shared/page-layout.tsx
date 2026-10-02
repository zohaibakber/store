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
  width = "full",
  ...props
}: ComponentProps<"div"> & {
  children: ReactNode;
  width?: PageWidth;
}) {
  return (
    <div data-slot="page-layout" className={cn("p-4", className)} {...props}>
      <div
        data-slot="page-layout-content"
        className={cn("flex w-full flex-col gap-4", widthClassNames[width])}
      >
        {children}
      </div>
    </div>
  );
}

function PageToolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="page-toolbar"
      className={cn("-my-4 flex h-16 min-w-0 shrink-0 items-center justify-end gap-2", className)}
      {...props}
    />
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
      className={cn("line-clamp-2 text-lg leading-tight font-medium wrap-anywhere", className)}
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

export {
  PageAction,
  PageContent,
  PageDescription,
  PageHeader,
  PageHeading,
  PageLayout,
  PageToolbar,
};
