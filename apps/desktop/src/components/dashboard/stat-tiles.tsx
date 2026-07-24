import type { DashboardAnalytics } from "@store/contracts";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice } from "@/lib/format";

interface StatTile {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}

const tilesFrom = (totals: DashboardAnalytics["totals"]): ReadonlyArray<StatTile> => [
  {
    label: "Revenue today",
    value: formatPrice(totals.revenueToday),
    detail: `${totals.invoicesToday} ${totals.invoicesToday === 1 ? "invoice" : "invoices"}`,
  },
  {
    label: "Revenue 30 days",
    value: formatPrice(totals.revenue30d),
    detail: `${formatPrice(totals.revenue7d)} in the last 7 days`,
  },
  {
    label: "Invoices 30 days",
    value: String(totals.invoices30d),
    detail: `${formatPrice(totals.averageInvoice30d)} average sale`,
  },
  {
    label: "Active products",
    value: String(totals.activeProducts),
    detail: "Visible to customers",
  },
];

export function StatTiles({ totals }: { totals: DashboardAnalytics["totals"] }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tilesFrom(totals).map((tile) => (
        <Card key={tile.label}>
          <CardHeader className="gap-1">
            <CardDescription>{tile.label}</CardDescription>
            <p className="font-medium font-mono text-2xl tracking-tighter tabular-nums">
              {tile.value}
            </p>
          </CardHeader>
          <CardContent className="text-muted-foreground">{tile.detail}</CardContent>
        </Card>
      ))}
    </div>
  );
}

export function StatTilesSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {[0, 1, 2, 3].map((slot) => (
        <Card key={slot}>
          <CardHeader className="gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-28" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-3 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
