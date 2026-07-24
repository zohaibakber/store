import { FrameCard } from "@/components/frame-card";
import type { DashboardAnalytics } from "@store/contracts";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";
import { ExpiringBatches, LowStock } from "@/components/dashboard/inventory-health";
import { RecentInvoices } from "@/components/dashboard/recent-invoices";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { StatTiles, StatTilesSkeleton } from "@/components/dashboard/stat-tiles";
import { TopProducts } from "@/components/dashboard/top-products";
import {
  PageContent,
  PageDescription,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { storeErrorMessage } from "@/lib/errors";

// Mirrors LOW_STOCK_THRESHOLD in @store/persistence — the store decides which
// products qualify; the page only names the number in its description.
const LOW_STOCK_THRESHOLD = 10;

function ChartSkeleton() {
  return (
    <FrameCard
      description={<Skeleton className="h-3 w-48" />}
      title={<Skeleton className="h-4 w-28" />}
    >
      <Skeleton className="h-56 w-full" />
    </FrameCard>
  );
}

export function HomePage() {
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setAnalytics(await window.offlineStore.getDashboardAnalytics());
    setError(null);
  }, []);

  useEffect(() => {
    refresh().catch((cause: unknown) => setError(storeErrorMessage(cause)));
  }, [refresh]);

  useEffect(() => {
    const handleSync = () => {
      void refresh().catch((cause: unknown) => setError(storeErrorMessage(cause)));
    };

    window.addEventListener("offline-store:sync", handleSync);
    return () => window.removeEventListener("offline-store:sync", handleSync);
  }, [refresh]);

  return (
    <PageLayout>
      <PageHeader>
        <PageHeading>Dashboard</PageHeading>
        <PageDescription>Sales and stock health from the on-device database.</PageDescription>
      </PageHeader>

      <PageContent>
        {error && (
          <Alert variant="error">
            <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
            <AlertTitle>Could not load the dashboard</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {analytics === null ? (
          <>
            <StatTilesSkeleton />
            <ChartSkeleton />
          </>
        ) : (
          <>
            <StatTiles totals={analytics.totals} />
            <RevenueChart data={analytics.revenueByDay} />
            <div className="grid gap-4 lg:grid-cols-2">
              <TopProducts products={analytics.topProducts} />
              <RecentInvoices invoices={analytics.recentInvoices} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <ExpiringBatches batches={analytics.expiringBatches} />
              <LowStock products={analytics.lowStock} threshold={LOW_STOCK_THRESHOLD} />
            </div>
          </>
        )}
      </PageContent>
    </PageLayout>
  );
}
