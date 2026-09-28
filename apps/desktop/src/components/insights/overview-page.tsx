import type { SalesRange } from "@store/services/insights";
import * as React from "react";

import { LoadingSpinner } from "@/components/app/loading-spinner";
import { PageContent, PageLayout } from "@/components/shared/page-layout";
import { SegmentedRadio } from "@/components/shared/segmented-radio";
import { useInventoryInsights } from "@/lib/inventory";

import { InsightsHeader } from "./header";
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

function OverviewBody({ range }: { readonly range: SalesRange }) {
  const { report } = useInventoryInsights();
  const period = report.sales.periods[range];
  return (
    <>
      <KpiGrid period={period} report={report} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AttentionFeed report={report} />
        </div>
        <StockHealth report={report} />
      </div>
      <RevenueTrend period={period} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopSellers period={period} />
        <SalesRhythm report={report} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ExpiringSoon report={report} />
        <React.Suspense fallback={<LoadingSpinner className="h-72" />}>
          <RecentInvoices />
        </React.Suspense>
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
  return (
    <PageLayout contentClassName="max-w-6xl gap-4">
      <InsightsHeader
        actions={
          <>
            <SegmentedRadio
              label="Reporting period"
              onValueChange={(value) => onRangeChange(RANGE_FROM_VALUE[value])}
              options={RANGE_OPTIONS}
              value={VALUE_FROM_RANGE[range]}
            />
            <PlanningSheet />
          </>
        }
      />
      <PageContent>
        <React.Suspense fallback={<LoadingSpinner className="min-h-96" label="Loading insights" />}>
          <OverviewBody range={range} />
        </React.Suspense>
      </PageContent>
    </PageLayout>
  );
}
