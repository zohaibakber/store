import type { DashboardAnalytics } from "@store/contracts";
import { Alert02Icon, PackageIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { formatDate } from "@/lib/format";

const DAY_MS = 86_400_000;

// Urgency mirrors the FEFO windows the analytics query uses: inside 30 days is
// destructive, the rest of the 90-day window is a warning.
const expiryUrgency = (expiresAt: number) => {
  const days = Math.max(0, Math.ceil((expiresAt - Date.now()) / DAY_MS));
  return {
    days,
    variant: days <= 30 ? ("error" as const) : ("warning" as const),
  };
};

function DashboardListRow({
  children,
  productId,
}: {
  children: React.ReactNode;
  productId: string;
}) {
  return (
    <Link
      className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 hover:bg-accent"
      params={{ productId }}
      to="/products/$productId"
    >
      {children}
    </Link>
  );
}

export function ExpiringBatches({ batches }: { batches: DashboardAnalytics["expiringBatches"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Expiring soon</CardTitle>
        <CardDescription>Batches with stock expiring in the next 90 days.</CardDescription>
      </CardHeader>
      <CardContent>
        {batches.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
              </EmptyMedia>
              <EmptyTitle>Nothing expiring</EmptyTitle>
              <EmptyDescription>No batches expire in the next 90 days.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {batches.map((batch) => {
              const urgency = expiryUrgency(batch.expiresAt);
              return (
                <DashboardListRow
                  key={`${batch.productId}-${batch.batchNumber ?? batch.expiresAt}`}
                  productId={batch.productId}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{batch.productName}</p>
                    <p className="truncate text-muted-foreground">
                      {batch.batchNumber ?? "Unnumbered batch"} · {batch.packQuantity} packs ·{" "}
                      {batch.unitQuantity} loose
                    </p>
                  </div>
                  <Badge className="shrink-0" variant={urgency.variant}>
                    {formatDate(batch.expiresAt)} · {urgency.days}d
                  </Badge>
                </DashboardListRow>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LowStock({
  products,
  threshold,
}: {
  products: DashboardAnalytics["lowStock"];
  threshold: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Low stock</CardTitle>
        <CardDescription>
          Visible products with {threshold} units or fewer remaining.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {products.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon aria-hidden="true" icon={PackageIcon} />
              </EmptyMedia>
              <EmptyTitle>Stock looks healthy</EmptyTitle>
              <EmptyDescription>No visible product is running low.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {products.map((product) => (
              <DashboardListRow key={product.productId} productId={product.productId}>
                <p className="min-w-0 truncate font-medium">{product.productName}</p>
                <Badge
                  className="shrink-0"
                  variant={product.packQuantity + product.unitQuantity === 0 ? "error" : "warning"}
                >
                  {product.packQuantity + product.unitQuantity === 0
                    ? "Out of stock"
                    : `${product.packQuantity} packs · ${product.unitQuantity} loose`}
                </Badge>
              </DashboardListRow>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
