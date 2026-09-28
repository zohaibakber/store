import * as React from "react";

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

export function InsightsHeader({ actions }: { readonly actions: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-end gap-2">
      <React.Suspense fallback={null}>
        <InsightsRefreshing />
      </React.Suspense>
      {actions}
    </header>
  );
}
