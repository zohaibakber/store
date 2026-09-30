import type { SalesRange } from "@store/services/insights";
import * as React from "react";

import { PageActions } from "@/components/shared/page-actions";
import { PageLayout } from "@/components/shared/page-layout";
import { SegmentedRadio } from "@/components/shared/segmented-radio";
import { useInventoryInsights } from "@/lib/inventory";

import { InsightsBuilding } from "./building";
import { InsightsFreshness } from "./freshness";
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
  const { summary, status } = useInventoryInsights();
  if (summary === null) return <InsightsBuilding status={status} />;
  const period = summary.sales.periods[range];
  return (
    <>
      <KpiGrid period={period} summary={summary} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AttentionFeed className="lg:col-span-2" summary={summary} />
        <StockHealth summary={summary} />
      </div>
      <RevenueTrend period={period} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopSellers period={period} />
        <SalesRhythm summary={summary} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ExpiringSoon summary={summary} />
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
  return (
    <PageLayout>
      <PageActions>
        <React.Suspense fallback={null}>
          <InsightsFreshness />
        </React.Suspense>
        <SegmentedRadio
          label="Reporting period"
          onValueChange={(value) => onRangeChange(RANGE_FROM_VALUE[value])}
          options={RANGE_OPTIONS}
          value={VALUE_FROM_RANGE[range]}
        />
        <PlanningSheet />
      </PageActions>
      <OverviewBody range={range} />
    </PageLayout>
  );
}
