import type { ErrorComponentProps } from "@tanstack/react-router";

import { RouteError } from "@/components/app/route-error";
import { useRefreshInventoryInsights } from "@/inventory/insights";

export function InsightsError(props: ErrorComponentProps) {
  const refresh = useRefreshInventoryInsights();
  return <RouteError {...props} onRetry={refresh} />;
}
