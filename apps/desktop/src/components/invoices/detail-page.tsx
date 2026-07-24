import { Alert02Icon, ArrowRightFreeIcons, Invoice01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Invoice } from "@store/contracts";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
import { Link } from "@tanstack/react-router";

import {
  PageContent,
  PageDescription,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Frame, FrameHeader } from "@/components/ui/frame";
import { formatDateTime, formatPrice } from "@/lib/format";

function BackToInvoices() {
  return (
    <Button className="-ml-1" render={<Link to="/invoices" />} size="sm" variant="ghost">
      <HugeiconsIcon aria-hidden="true" icon={Invoice01Icon} />
    </Button>
  );
}

function InvoiceDetailError({ error }: { error: Error }) {
  return (
    <PageLayout contentClassName="max-w-3xl">
      <PageHeader>
        <BackToInvoices />
      </PageHeader>
      <PageContent>
        <Alert variant="error">
          <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
          <AlertTitle>Could not load invoice</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </PageContent>
    </PageLayout>
  );
}

function InvoiceDetailPage({ invoice }: { invoice: Invoice }) {
  const unitsSold = invoice.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <PageLayout contentClassName="max-w-3xl">
      <PageHeader>
        <div className="flex items-center">
          <BackToInvoices />
          <HugeiconsIcon aria-hidden="true" className="size-4" icon={ArrowRightFreeIcons} />
          <PageHeading className="ml-2">
            Invoice{" "}
            <span className="font-mono tabular-nums">
              #{formatInvoiceNumber(invoice.invoiceNumber)}
            </span>
          </PageHeading>
        </div>
        <PageDescription>
          {invoice.customerName ?? "Walk-in customer"} ·{" "}
          <span className="font-mono tabular-nums">{formatDateTime(invoice.createdAt)}</span>
        </PageDescription>
      </PageHeader>

      <PageContent className="gap-4">
        {/* Same row shape as the new-sale page, minus the controls. */}
        <div className="flex flex-col gap-2">
          {invoice.items.map((item) => (
            <Frame className="w-full" key={item.id}>
              <FrameHeader className="flex-row items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.productName}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground tabular-nums">
                    {item.batchNumber ? `Batch ${item.batchNumber}` : "Unnumbered batch"}
                    {" · "}
                    {item.quantity} {item.quantityType === "pack" ? "packs" : "units"} ×{" "}
                    {formatPrice(item.salePrice)}
                  </p>
                </div>
                <span className="font-mono font-medium tabular-nums">
                  {formatPrice(item.quantity * item.salePrice)}
                </span>
              </FrameHeader>
            </Frame>
          ))}
        </div>

        <div className="flex flex-col gap-1 rounded-2xl border p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Items</span>
            <span className="font-mono tabular-nums">
              {invoice.items.length} {invoice.items.length === 1 ? "line" : "lines"} · {unitsSold}
            </span>
          </div>
          <div className="flex items-center justify-between text-xl font-medium">
            <span>Total</span>
            <span className="font-mono tabular-nums">{formatPrice(invoice.total)}</span>
          </div>
        </div>
      </PageContent>
    </PageLayout>
  );
}

export { InvoiceDetailError, InvoiceDetailPage };
