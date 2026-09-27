import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  CheckmarkCircle02Icon,
  PackageIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatPrice } from "@store/services/format";
import type { InsightsReport, SalesPeriod, TopProduct } from "@store/services/insights";
import { Link } from "@tanstack/react-router";
import * as React from "react";

import { FrameCard } from "@/components/shared/frame-card";
import { Button } from "@/components/ui/button";
import { Chart, ChartContainer, CHART_HEIGHT } from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Meter, MeterIndicator, MeterLabel, MeterTrack, MeterValue } from "@/components/ui/meter";
import { formatDate } from "@/lib/format";

import { createRevenueTrendChart, createWeekdayChart } from "./charts";
import { InsightList, InsightRow, InsightRowLink } from "./list";
import {
  formatCount,
  formatHour,
  formatShare,
  HEALTH_ORDER,
  SEVERITY_TONE,
  STATUS_META,
  WEEKDAY_SHORT,
} from "./presentation";
import { ToneDot } from "./status-badge";

const ATTENTION_LIMIT = 6;

function EmptyState({
  icon,
  title,
  description,
}: {
  readonly icon: typeof PackageIcon;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon aria-hidden="true" icon={icon} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function AttentionFeed({ report }: { readonly report: InsightsReport }) {
  const alerts = report.alerts.slice(0, ATTENTION_LIMIT);
  return (
    <FrameCard
      action={
        <Button render={<Link to="/restock" />} size="sm" variant="ghost">
          Restock plan
          <HugeiconsIcon aria-hidden="true" icon={ArrowRight01Icon} />
        </Button>
      }
      description="Ranked by urgency and money at stake."
      title="Needs attention"
    >
      {alerts.length === 0 ? (
        <EmptyState
          description="Stock covers expected demand and nothing is about to expire."
          icon={CheckmarkCircle02Icon}
          title="All clear"
        />
      ) : (
        <InsightList aria-label="Alerts">
          {alerts.map((alert) => (
            <InsightRow key={alert.id}>
              <ToneDot tone={SEVERITY_TONE[alert.severity]} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {alert.productId === null ? (
                  <span className="truncate font-medium">{alert.title}</span>
                ) : (
                  <InsightRowLink params={{ productId: alert.productId }} to="/products/$productId">
                    {alert.title}
                  </InsightRowLink>
                )}
                <span className="truncate text-xs text-muted-foreground">{alert.detail}</span>
              </div>
            </InsightRow>
          ))}
        </InsightList>
      )}
    </FrameCard>
  );
}

export function StockHealth({ report }: { readonly report: InsightsReport }) {
  const tracked = HEALTH_ORDER.reduce((total, status) => total + report.counts[status], 0);
  return (
    <FrameCard
      description={`${formatCount(tracked)} products with stock or sales.`}
      title="Stock health"
    >
      <div className="flex flex-col gap-4">
        {HEALTH_ORDER.map((status) => (
          <Meter key={status} max={Math.max(tracked, 1)} value={report.counts[status]}>
            <div className="flex items-center justify-between gap-2">
              <MeterLabel>
                <span className="flex items-center gap-2">
                  <ToneDot tone={STATUS_META[status].tone} />
                  {STATUS_META[status].label}
                </span>
              </MeterLabel>
              <MeterValue>{(_formatted, value) => formatCount(value)}</MeterValue>
            </div>
            <MeterTrack>
              <MeterIndicator />
            </MeterTrack>
          </Meter>
        ))}
        {report.inventory.reorderCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            {formatCount(report.inventory.reorderCount)} to order
            {report.inventory.reorderCost > 0
              ? ` · about ${formatPrice(report.inventory.reorderCost)}`
              : ""}
          </p>
        ) : null}
      </div>
    </FrameCard>
  );
}

export function RevenueTrend({ period }: { readonly period: SalesPeriod }) {
  const definition = React.useMemo(() => createRevenueTrendChart(period.series), [period.series]);
  return (
    <FrameCard
      description={`Daily revenue, dashed line is the previous ${period.days} days.`}
      title="Revenue"
    >
      <ChartContainer className="aspect-auto h-56 w-full">
        <Chart
          ariaLabel={`Daily revenue over the last ${period.days} days compared with the period before`}
          className="w-full"
          definition={definition}
          height={CHART_HEIGHT}
        />
      </ChartContainer>
    </FrameCard>
  );
}

function TrendIcon({ trend }: { readonly trend: TopProduct["trend"] }) {
  if (trend === "rising") {
    return (
      <HugeiconsIcon
        aria-label="Selling faster"
        className="size-4 text-success-foreground"
        icon={ArrowUp01Icon}
      />
    );
  }
  if (trend === "falling") {
    return (
      <HugeiconsIcon
        aria-label="Selling slower"
        className="size-4 text-destructive-foreground"
        icon={ArrowDown01Icon}
      />
    );
  }
  return null;
}

export function TopSellers({ period }: { readonly period: SalesPeriod }) {
  return (
    <FrameCard
      description={`Share of product revenue, last ${period.days} days.`}
      title="Top sellers"
    >
      {period.topProducts.length === 0 ? (
        <EmptyState
          description="Record a sale and leaders show up here."
          icon={PackageIcon}
          title="No sales yet"
        />
      ) : (
        <InsightList aria-label="Top sellers">
          {period.topProducts.slice(0, 6).map((product) => (
            <InsightRow className="flex-col items-stretch gap-2" key={product.productId}>
              <div className="flex items-center gap-2">
                <InsightRowLink
                  className="flex-1"
                  params={{ productId: product.productId }}
                  to="/products/$productId"
                >
                  {product.name}
                </InsightRowLink>
                <TrendIcon trend={product.trend} />
                <span className="text-sm tabular-nums">{formatPrice(product.revenue)}</span>
              </div>
              <Meter aria-label={`${product.name} revenue share`} max={1} value={product.share}>
                <MeterTrack>
                  <MeterIndicator />
                </MeterTrack>
              </Meter>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatCount(product.units)} units · {formatShare(product.share)}
              </span>
            </InsightRow>
          ))}
        </InsightList>
      )}
    </FrameCard>
  );
}

export function SalesRhythm({ report }: { readonly report: InsightsReport }) {
  const peakWeekday = report.sales.weekdays.reduce(
    (best, day) => (day.revenue > best.revenue ? day : best),
    { weekday: -1, revenue: 0 },
  );
  const rows = React.useMemo(
    () =>
      report.sales.weekdays.map((day) => ({ ...day, peak: day.weekday === peakWeekday.weekday })),
    [report.sales.weekdays, peakWeekday.weekday],
  );
  const definition = React.useMemo(() => createWeekdayChart(rows), [rows]);
  const peakHour = report.sales.peakHour;
  return (
    <FrameCard
      description={
        peakWeekday.weekday < 0
          ? "Average revenue by weekday over the last 8 weeks."
          : `${WEEKDAY_SHORT[peakWeekday.weekday]} is your busiest day${
              peakHour === null ? "" : `, and sales peak around ${formatHour(peakHour)}`
            }.`
      }
      title="Sales rhythm"
    >
      <ChartContainer className="aspect-auto h-56 w-full">
        <Chart
          ariaLabel="Average revenue by weekday over the last eight weeks"
          className="w-full"
          definition={definition}
          height={CHART_HEIGHT}
        />
      </ChartContainer>
    </FrameCard>
  );
}

export function ExpiringSoon({ report }: { readonly report: InsightsReport }) {
  const batches = report.expiring.slice(0, 6);
  return (
    <FrameCard
      description={`Batches expiring within ${report.policy.expiryWarningDays} days.`}
      title="Expiring soon"
    >
      {batches.length === 0 ? (
        <EmptyState
          description="No stocked batch expires inside the warning window."
          icon={CheckmarkCircle02Icon}
          title="Nothing expiring"
        />
      ) : (
        <InsightList aria-label="Expiring batches">
          {batches.map((batch) => (
            <InsightRow key={`${batch.productId}-${batch.batchNumber ?? batch.expiresAt}`}>
              <ToneDot tone={batch.atRiskUnits > 0 ? "warning" : "secondary"} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <InsightRowLink params={{ productId: batch.productId }} to="/products/$productId">
                  {batch.name}
                </InsightRowLink>
                <span className="truncate text-xs text-muted-foreground">
                  {batch.batchNumber ?? "Unnumbered batch"} · {formatCount(batch.units)} units
                  {batch.atRiskUnits > 0
                    ? ` · ${formatCount(batch.atRiskUnits)} unlikely to sell`
                    : ""}
                </span>
              </div>
              <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                {formatDate(batch.expiresAt)}
              </span>
            </InsightRow>
          ))}
        </InsightList>
      )}
    </FrameCard>
  );
}
