import { Link, type LinkProps } from "@tanstack/react-router";
import type * as React from "react";

import { cn } from "@/lib/utils";

export function InsightList({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul className={cn("flex flex-col", className)} data-slot="insight-list" {...props} />;
}

export function InsightRow({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      className={cn(
        "relative flex items-center gap-3 py-3 not-last:border-b has-[a:focus-visible]:bg-accent/40 has-[a:hover]:bg-accent/40",
        className,
      )}
      data-slot="insight-row"
      {...props}
    />
  );
}

export function InsightRowLink({
  className,
  ...props
}: LinkProps & { readonly className?: string; readonly children: React.ReactNode }) {
  return (
    <Link
      className={cn(
        "min-w-0 truncate font-medium outline-none before:absolute before:inset-0 focus-visible:underline",
        className,
      )}
      {...props}
    />
  );
}
