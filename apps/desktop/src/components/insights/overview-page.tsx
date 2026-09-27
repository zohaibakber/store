import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { InsightsReport, SalesRange } from "@store/services/insights";

import {
  PageAction,
  PageContent,
  PageDescription,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/shared/page-layout";
import { SegmentedRadio } from "@/components/shared/segmented-radio";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useInventoryInsights } from "@/lib/inventory";

import { KpiGrid } from "./kpis";
import { PlanningSheet } from "./planning-sheet";
import { RecentInvoices } from "./recent-invoices";
import {
  AttentionFeed,
  ExpiringSoon,
  RevenueTrend,
  SalesRhythm,
  StockHealth,
  TopSellers,
} from "./sections";

const RANGE_OPTIONS = [
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
] as const;

type RangeValue = (typeof RANGE_OPTIONS)[number]["value"];

const RANGE_FROM_VALUE = { "7": 7, "30": 30, "90": 90 } satisfies Record<RangeValue, SalesRange>;
const VALUE_FROM_RANGE = { 7: "7", 30: "30", 90: "90" } satisfies Record<SalesRange, RangeValue>;

const greeting = (hour: number) =>
  hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

function OverviewLoading() {
  return (
    <div aria-busy="true" aria-label="Loading insights" className="flex flex-col gap-4">
      <Skeleton className="h-32 w-full" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function OverviewBody({
  report,
  range,
}: {
  readonly report: InsightsReport;
  readonly range: SalesRange;
}) {
  const period = report.sales.periods[range];
  return (
    <>
      <KpiGrid period={period} report={report} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AttentionFeed report={report} />
        </div>
        <StockHealth report={report} />
      </div>
      <RevenueTrend period={period} />
      <div className="grid gap-4 lg:grid-cols-2">
        <TopSellers period={period} />
        <SalesRhythm report={report} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ExpiringSoon report={report} />
        <RecentInvoices />
      </div>
    </>
  );
}

export function OverviewPage({
  range,
  onRangeChange,
}: {
  readonly range: SalesRange;
  readonly onRangeChange: (range: SalesRange) => void;
}) {
  const insights = useInventoryInsights();
  return (
    <PageLayout contentClassName="max-w-6xl gap-4">
      <PageHeader>
        <PageHeading className="text-lg">{greeting(new Date().getHours())}</PageHeading>
        <PageDescription>
          {insights._tag === "Ready" && insights.refreshing
            ? "Refreshing from this device…"
            : "Sales, stock, and what to do next, from data on this device."}
        </PageDescription>
        <PageAction className="flex items-center gap-2">
          <SegmentedRadio
            label="Reporting period"
            onValueChange={(value) => onRangeChange(RANGE_FROM_VALUE[value])}
            options={RANGE_OPTIONS}
            value={VALUE_FROM_RANGE[range]}
          />
          <PlanningSheet />
        </PageAction>
      </PageHeader>
      <PageContent>
        {insights._tag === "Loading" ? <OverviewLoading /> : null}
        {insights._tag === "Error" ? (
          <Alert variant="error">
            <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
            <AlertTitle>Could not analyze inventory</AlertTitle>
            <AlertDescription>{insights.message}</AlertDescription>
          </Alert>
        ) : null}
        {insights._tag === "Ready" ? <OverviewBody range={range} report={insights.report} /> : null}
      </PageContent>
    </PageLayout>
  );
}
