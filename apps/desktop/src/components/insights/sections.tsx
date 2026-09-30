import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  ChartLineData02Icon,
  CheckmarkCircle02Icon,
  PackageAdd01Icon,
  PackageIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { InsightsSummary } from "@store/contracts";
import { formatPrice } from "@store/services/format";
import type { SalesPeriod, StockStatus, TopProduct } from "@store/services/insights";
import { Link } from "@tanstack/react-router";
import * as React from "react";

import { FrameCard } from "@/components/shared/frame-card";
import { Button } from "@/components/ui/button";
import { Chart, ChartContainer } from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EMPTY, formatCount, formatDate, formatNumber } from "@/lib/format";

import { createRevenueTrendChart, createWeekdayChart } from "./charts";
import { InsightMeter } from "./meter";
import {
  formatHour,
  formatOrder,
  formatShare,
  formatStockCover,
  HEALTH_ORDER,
  STATUS_META,
  WEEKDAY_SHORT,
} from "./presentation";
import type { RestockView } from "./restock-page";
import { StatusBadge, StatusDot } from "./status-badge";

const ATTENTION_LIMIT = 6;
const REVENUE_CHART_HEIGHT = 160;
const WEEKDAY_CHART_HEIGHT = 128;

const HEALTH_VIEW = {
  out: "out",
  critical: "critical",
  low: "low",
  healthy: "all",
  overstock: "overstock",
  dead: "dead",
  inactive: "all",
} satisfies Record<StockStatus, RestockView>;

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

function ViewAll({ children, to }: { readonly children: string; readonly to: "/restock" }) {
  return (
    <Button render={<Link to={to} />} size="xs" variant="ghost">
      {children}
      <HugeiconsIcon aria-hidden="true" icon={ArrowRight01Icon} />
    </Button>
  );
}

function End({ children }: { readonly children: React.ReactNode }) {
  return <div className="text-right tabular-nums">{children}</div>;
}

function Muted({ children }: { readonly children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function NameCell({ children }: { readonly children: React.ReactNode }) {
  return (
    <TableCell className="w-full">
      <div className="flex w-0 min-w-full items-center gap-1.5">{children}</div>
    </TableCell>
  );
}

function ProductLink({
  productId,
  children,
}: {
  readonly productId: string;
  readonly children: React.ReactNode;
}) {
  return (
    <Link
      className="min-w-0 truncate leading-tight font-medium outline-none before:absolute before:inset-0 focus-visible:underline"
      params={{ productId }}
      to="/products/$productId"
    >
      {children}
    </Link>
  );
}

export function AttentionFeed({
  className,
  summary,
}: {
  readonly className?: string;
  readonly summary: InsightsSummary;
}) {
  const shown = summary.attention.slice(0, ATTENTION_LIMIT);
  const notes = summary.alerts.filter((alert) => alert.productId === null);
  return (
    <FrameCard
      action={<ViewAll to="/restock">Restock plan</ViewAll>}
      className={className}
      description={
        summary.attentionCount > 0 ? formatCount(summary.attentionCount, "product") : undefined
      }
      flush
      title="Needs attention"
    >
      {shown.length === 0 ? (
        <EmptyState
          description="Stock covers expected demand for every product."
          icon={CheckmarkCircle02Icon}
          title="All clear"
        />
      ) : (
        <Table aria-label="Products that need restocking">
          <TableHeader>
            <TableRow>
              <TableHead className="h-8">Product</TableHead>
              <TableHead className="h-8">Status</TableHead>
              <TableHead className="h-8">
                <End>Cover</End>
              </TableHead>
              <TableHead className="h-8">
                <End>Suggested order</End>
              </TableHead>
              <TableHead className="h-8">
                <End>Lost sales / day</End>
              </TableHead>
              <TableHead className="h-8">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((insight) => (
              <TableRow key={insight.productId}>
                <NameCell>
                  <ProductLink productId={insight.productId}>{insight.name}</ProductLink>
                </NameCell>
                <TableCell>
                  <StatusBadge status={insight.status} />
                </TableCell>
                <TableCell>
                  <End>
                    <Muted>{formatStockCover(insight)}</Muted>
                  </End>
                </TableCell>
                <TableCell>
                  <End>
                    {insight.order === null ? <Muted>{EMPTY}</Muted> : formatOrder(insight.order)}
                  </End>
                </TableCell>
                <TableCell>
                  <End>
                    {insight.lostRevenuePerDay > 0 ? (
                      formatPrice(Math.round(insight.lostRevenuePerDay))
                    ) : (
                      <Muted>{EMPTY}</Muted>
                    )}
                  </End>
                </TableCell>
                <TableCell>
                  <div className="relative z-10 -my-1 flex justify-end">
                    <Button
                      aria-label={`Add stock to ${insight.name}`}
                      render={
                        <Link
                          params={{ productId: insight.productId }}
                          search={{ addStock: true }}
                          to="/products/$productId"
                        />
                      }
                      size="icon-xs"
                      title="Add stock"
                      variant="ghost"
                    >
                      <HugeiconsIcon aria-hidden="true" icon={PackageAdd01Icon} />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {notes.map((note) => (
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground" key={note.id}>
          <span className="text-foreground">{note.title}.</span> {note.detail}
        </p>
      ))}
    </FrameCard>
  );
}

export function StockHealth({ summary }: { readonly summary: InsightsSummary }) {
  const tracked = HEALTH_ORDER.reduce((total, status) => total + summary.counts[status], 0);
  return (
    <FrameCard description={formatCount(tracked, "product")} flush title="Stock health">
      <div className="flex flex-col gap-1 p-2">
        <ul aria-label="Products by stock status" className="flex flex-col">
          {HEALTH_ORDER.map((status) => {
            const meta = STATUS_META[status];
            const count = summary.counts[status];
            return (
              <li
                className="relative flex h-8 items-center gap-3 rounded-md px-2 hover:bg-accent/40"
                key={status}
              >
                <Link
                  className="flex w-28 shrink-0 items-center gap-2 truncate text-sm outline-none before:absolute before:inset-0 before:rounded-md focus-visible:before:ring-2 focus-visible:before:ring-ring"
                  search={{ view: HEALTH_VIEW[status] }}
                  to="/restock"
                >
                  <StatusDot status={status} />
                  {meta.label}
                </Link>
                <InsightMeter
                  className="flex-1"
                  label={`${meta.label}: ${formatCount(count, "product")}`}
                  max={tracked}
                  tone={meta.tone}
                  value={count}
                />
                <span className="w-12 shrink-0 text-right text-sm tabular-nums">
                  {formatNumber(count)}
                </span>
              </li>
            );
          })}
        </ul>
        {summary.inventory.reorderCount > 0 ? (
          <p className="px-2 pb-1 text-xs text-muted-foreground tabular-nums">
            {formatCount(summary.inventory.reorderCount, "product")} to order
            {summary.inventory.reorderCost > 0
              ? ` · about ${formatPrice(summary.inventory.reorderCost)}`
              : ""}
          </p>
        ) : null}
      </div>
    </FrameCard>
  );
}

function ChartLegend({ items }: { readonly items: ReadonlyArray<readonly [string, string]> }) {
  return (
    <span className="flex items-center gap-3 text-xs text-muted-foreground">
      {items.map(([label, swatch]) => (
        <span className="flex items-center gap-1.5" key={label}>
          <span aria-hidden="true" className={swatch} />
          {label}
        </span>
      ))}
    </span>
  );
}

export function RevenueTrend({ period }: { readonly period: SalesPeriod }) {
  const definition = React.useMemo(() => createRevenueTrendChart(period.series), [period.series]);
  return (
    <FrameCard
      action={
        <ChartLegend
          items={[
            [`Last ${period.days} days`, "h-0.5 w-3 rounded-full bg-chart-1"],
            ["Previous period", "h-0 w-3 border-t border-dashed border-muted-foreground"],
          ]}
        />
      }
      flush
      title="Revenue"
    >
      {period.series.every((day) => day.revenue === 0 && day.previousRevenue === 0) ? (
        <EmptyState
          description="Revenue shows up here once you record sales."
          icon={ChartLineData02Icon}
          title={`No sales in the last ${period.days} days`}
        />
      ) : (
        <div className="px-4 py-3">
          <ChartContainer className="aspect-auto h-40 w-full">
            <Chart
              ariaLabel={`Daily revenue over the last ${period.days} days compared with the period before`}
              className="w-full"
              definition={definition}
              height={REVENUE_CHART_HEIGHT}
            />
          </ChartContainer>
        </div>
      )}
    </FrameCard>
  );
}

function TrendIcon({ trend }: { readonly trend: TopProduct["trend"] }) {
  if (trend === "rising") {
    return (
      <HugeiconsIcon
        aria-label="Selling faster"
        className="size-3.5 shrink-0 text-success-foreground"
        icon={ArrowUp01Icon}
      />
    );
  }
  if (trend === "falling") {
    return (
      <HugeiconsIcon
        aria-label="Selling slower"
        className="size-3.5 shrink-0 text-destructive-foreground"
        icon={ArrowDown01Icon}
      />
    );
  }
  return null;
}

export function TopSellers({ period }: { readonly period: SalesPeriod }) {
  const products = period.topProducts.slice(0, 7);
  const topShare = products[0]?.share ?? 1;
  return (
    <FrameCard description={`Last ${period.days} days`} flush title="Top sellers">
      {products.length === 0 ? (
        <EmptyState
          description="Record a sale and leaders show up here."
          icon={PackageIcon}
          title="No sales yet"
        />
      ) : (
        <Table aria-label="Top sellers">
          <TableHeader>
            <TableRow>
              <TableHead className="h-8">Product</TableHead>
              <TableHead className="h-8">
                <End>Units</End>
              </TableHead>
              <TableHead className="h-8">
                <End>Revenue</End>
              </TableHead>
              <TableHead className="h-8">
                <End>Share</End>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => (
              <TableRow key={product.productId}>
                <NameCell>
                  <ProductLink productId={product.productId}>{product.name}</ProductLink>
                  <TrendIcon trend={product.trend} />
                </NameCell>
                <TableCell>
                  <End>
                    <Muted>{formatNumber(product.units)}</Muted>
                  </End>
                </TableCell>
                <TableCell>
                  <End>{formatPrice(product.revenue)}</End>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <InsightMeter
                      className="w-16"
                      label={`${product.name}: ${formatShare(product.share)} of product revenue`}
                      max={topShare}
                      value={product.share}
                    />
                    <span className="w-9 text-right text-muted-foreground tabular-nums">
                      {formatShare(product.share)}
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </FrameCard>
  );
}

export function SalesRhythm({ summary }: { readonly summary: InsightsSummary }) {
  const peakWeekday = summary.sales.weekdays.reduce(
    (best, day) => (day.revenue > best.revenue ? day : best),
    { weekday: -1, revenue: 0 },
  );
  const rows = React.useMemo(
    () =>
      summary.sales.weekdays.map((day) => ({ ...day, peak: day.weekday === peakWeekday.weekday })),
    [summary.sales.weekdays, peakWeekday.weekday],
  );
  const definition = React.useMemo(() => createWeekdayChart(rows), [rows]);
  const peakHour = summary.sales.peakHour;
  const busiestHours = [...summary.sales.hours]
    .filter((entry) => entry.invoices > 0)
    .sort((left, right) => right.invoices - left.invoices)
    .slice(0, 3);
  return (
    <FrameCard
      description={
        peakWeekday.weekday < 0
          ? "Last 8 weeks"
          : `Busiest on ${WEEKDAY_SHORT[peakWeekday.weekday]}${
              peakHour === null ? "" : `, peaks around ${formatHour(peakHour)}`
            }`
      }
      flush
      title="Sales rhythm"
    >
      {peakWeekday.weekday < 0 ? (
        <EmptyState
          description="Weekday and hourly patterns appear after a few weeks of sales."
          icon={ChartLineData02Icon}
          title="Not enough sales yet"
        />
      ) : (
        <div className="flex flex-col gap-2 px-4 py-3">
          <ChartContainer className="aspect-auto h-32 w-full">
            <Chart
              ariaLabel="Average revenue by weekday over the last eight weeks"
              className="w-full"
              definition={definition}
              height={WEEKDAY_CHART_HEIGHT}
            />
          </ChartContainer>
          {busiestHours.length === 0 ? null : (
            <div className="flex flex-col">
              <span className="pb-1 text-xs text-muted-foreground">Busiest hours</span>
              <ul aria-label="Busiest hours" className="flex flex-col">
                {busiestHours.map((entry) => (
                  <li className="flex h-7 items-center gap-3 text-sm" key={entry.hour}>
                    <span className="w-14 shrink-0 tabular-nums">{formatHour(entry.hour)}</span>
                    <InsightMeter
                      className="flex-1"
                      label={`${formatHour(entry.hour)}: ${formatCount(entry.invoices, "sale")}`}
                      max={busiestHours[0]?.invoices ?? 1}
                      value={entry.invoices}
                    />
                    <span className="w-20 shrink-0 text-right text-muted-foreground tabular-nums">
                      {formatCount(entry.invoices, "sale")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </FrameCard>
  );
}

export function ExpiringSoon({ summary }: { readonly summary: InsightsSummary }) {
  const batches = summary.expiring.slice(0, 6);
  return (
    <FrameCard
      description={`Within ${formatCount(summary.policy.expiryWarningDays, "day")}`}
      flush
      title="Expiring soon"
    >
      {batches.length === 0 ? (
        <EmptyState
          description="No stocked batch expires inside the warning window."
          icon={CheckmarkCircle02Icon}
          title="Nothing expiring"
        />
      ) : (
        <Table aria-label="Expiring batches">
          <TableHeader>
            <TableRow>
              <TableHead className="h-8">Product</TableHead>
              <TableHead className="h-8">Batch</TableHead>
              <TableHead className="h-8">
                <End>Units</End>
              </TableHead>
              <TableHead className="h-8">
                <End>At risk</End>
              </TableHead>
              <TableHead className="h-8">
                <End>Expires</End>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.map((batch) => (
              <TableRow key={`${batch.productId}-${batch.batchNumber ?? batch.expiresAt}`}>
                <NameCell>
                  <ProductLink productId={batch.productId}>{batch.name}</ProductLink>
                </NameCell>
                <TableCell>
                  <span className="text-muted-foreground">{batch.batchNumber ?? EMPTY}</span>
                </TableCell>
                <TableCell>
                  <End>{formatNumber(batch.units)}</End>
                </TableCell>
                <TableCell>
                  <End>
                    {batch.atRiskUnits > 0 ? (
                      <span className="text-warning-foreground">
                        {formatNumber(batch.atRiskUnits)}
                      </span>
                    ) : (
                      <Muted>{EMPTY}</Muted>
                    )}
                  </End>
                </TableCell>
                <TableCell>
                  <End>
                    <Muted>{formatDate(batch.expiresAt)}</Muted>
                  </End>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </FrameCard>
  );
}
