import type * as React from "react";

import { Spinner } from "@/components/ui/spinner";
import { useInventoryInsights } from "@/lib/inventory";

export function InsightsRefreshing() {
  const { refreshing } = useInventoryInsights();
  if (!refreshing) return null;
  return (
    <span className="ms-2 inline-flex items-center gap-1 align-middle" role="status">
      <Spinner />
      <span className="sr-only">Updating insights</span>
    </span>
  );
}

export function InsightsHeader({
  actions,
  description,
  title,
}: {
  readonly title: string;
  readonly description: React.ReactNode;
  readonly actions: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-lg leading-none font-medium">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </header>
  );
}
