import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { ExpiringBatches } from "@/components/dashboard/inventory-health";
import { RecentInvoices } from "@/components/dashboard/recent-invoices";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { StatTiles } from "@/components/dashboard/stat-tiles";
import { StockRecommendations } from "@/components/dashboard/stock-recommendations";
import { TopProducts } from "@/components/dashboard/top-products";
import { PageContent, PageLayout } from "@/components/shared/page-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useInventoryDashboardAnalytics } from "@/lib/inventory-db";
import { stockPolicyAtom } from "@/lib/inventory/atoms";

export function HomePage() {
  const policy = useAtomValue(stockPolicyAtom);
  const setPolicy = useAtomSet(stockPolicyAtom);
  const analytics = useInventoryDashboardAnalytics(policy);

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
            <StockRecommendations
              state={analytics.recommendations}
              policy={policy}
              onPolicyChange={setPolicy}
            />
            <RevenueChart data={analytics.data.revenueByDay} />
            <div className="grid gap-4 lg:grid-cols-2">
              <TopProducts products={analytics.data.topProducts} />
              <RecentInvoices invoices={analytics.data.recentInvoices} />
            </div>
            <ExpiringBatches batches={analytics.data.expiringBatches} />
          </>
        )}
      </PageContent>
    </PageLayout>
  );
}
