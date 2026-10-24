import { useRefreshInventoryInsights } from "@store/inventory-react";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { RouteError } from "@/components/app/route-error";

export function InsightsError(props: ErrorComponentProps) {
  const refresh = useRefreshInventoryInsights();
  return <RouteError {...props} onRetry={refresh} />;
}
