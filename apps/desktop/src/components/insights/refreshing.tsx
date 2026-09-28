import { Spinner } from "@/components/ui/spinner";
import { useInventoryInsights } from "@/lib/inventory";

export function InsightsRefreshing() {
  const { refreshing } = useInventoryInsights();
  if (!refreshing) return null;
  return (
    <span className="inline-flex items-center" role="status">
      <Spinner />
      <span className="sr-only">Updating insights</span>
    </span>
  );
}
