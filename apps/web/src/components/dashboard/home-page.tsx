import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { ExpiringBatches, LowStock } from "@/components/dashboard/inventory-health";
import { RecentInvoices } from "@/components/dashboard/recent-invoices";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { StatTiles } from "@/components/dashboard/stat-tiles";
import { TopProducts } from "@/components/dashboard/top-products";
import { PageContent, PageLayout } from "@/components/shared/page-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useInventoryDashboardAnalytics, useInventoryState } from "@/lib/inventory-db";

const LOW_STOCK_THRESHOLD = 10;

export function HomePage() {
  const state = useInventoryState();
  if (!state || state._tag !== "Ready") throw new Error("Dashboard storage is not ready.");
  return <LiveDashboard inventory={state.inventory} />;
}

function LiveDashboard({
  inventory,
}: {
  readonly inventory: Extract<
    NonNullable<ReturnType<typeof useInventoryState>>,
    { _tag: "Ready" }
  >["inventory"];
}) {
  const analytics = useInventoryDashboardAnalytics(inventory);

  return (
    <PageLayout>
      <PageContent>
        {analytics.isError && (
          <Alert variant="error">
            <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
            <AlertTitle>
              {analytics.hasCachedData
                ? "Showing saved inventory"
                : "Could not refresh the dashboard"}
            </AlertTitle>
            <AlertDescription>
              {analytics.hasCachedData
                ? "The server is unavailable. This dashboard uses data saved on this device."
                : "Inventory data is unavailable. Check your connection and try again."}
            </AlertDescription>
          </Alert>
        )}

        {analytics.isError && !analytics.hasCachedData ? null : (
          <>
            <StatTiles totals={analytics.data.totals} />
            <RevenueChart data={analytics.data.revenueByDay} />
            <div className="grid gap-4 lg:grid-cols-2">
              <TopProducts products={analytics.data.topProducts} />
              <RecentInvoices invoices={analytics.data.recentInvoices} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <ExpiringBatches batches={analytics.data.expiringBatches} />
              <LowStock products={analytics.data.lowStock} threshold={LOW_STOCK_THRESHOLD} />
            </div>
          </>
        )}
      </PageContent>
    </PageLayout>
  );
}
