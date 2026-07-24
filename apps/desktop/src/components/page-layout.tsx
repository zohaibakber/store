import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

function PageLayout({
  children,
  className,
  contentClassName,
  ...props
}: ComponentProps<"div"> & { children: ReactNode; contentClassName?: string }) {
  return (
    <div data-slot="page-layout" className={cn("p-4", className)} {...props}>
      <div
        data-slot="page-layout-content"
        className={cn("mx-auto flex w-full flex-col gap-2 max-w-5xl", contentClassName)}
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
        "grid auto-rows-min items-center has-data-[slot=page-action]:grid-cols-[1fr_auto]",
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
      className={cn("text-2xl font-medium tracking-tight", className)}
      {...props}
    />
  );
}

function PageDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p data-slot="page-description" className={cn("text-muted-foreground", className)} {...props} />
  );
}

function PageAction({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="page-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

export { PageAction, PageContent, PageDescription, PageHeader, PageHeading, PageLayout };
