import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Invoice, InvoiceItem } from "@store/contracts";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
import { formatPrice } from "@store/services/format";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";

import { DetailLoadError } from "@/components/shared/detail-load-error";
import { FrameCard } from "@/components/shared/frame-card";
import {
  PageAction,
  PageDescription,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/shared/page-layout";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EMPTY, formatCount } from "@/lib/format";

function NewSaleAction() {
  return (
    <Button render={<Link to="/invoices/new" />} size="sm">
      <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
      New sale
    </Button>
  );
}

function InvoiceDetailError({ error }: { error: unknown }) {
  return (
    <DetailLoadError error={error} subject="invoice">
      <Button render={<Link to="/invoices" />} size="sm" variant="outline">
        Back to invoices
      </Button>
    </DetailLoadError>
  );
}

const itemTotal = (item: InvoiceItem) => item.quantity * item.salePrice;

function AmountCell({ children, strong = false }: { children: string; strong?: boolean }) {
  return (
    <TableCell>
      <span
        className={
          strong ? "block text-end font-medium tabular-nums" : "block text-end tabular-nums"
        }
      >
        {children}
      </span>
    </TableCell>
  );
}

function InvoiceDetailPage({ invoice }: { invoice: Invoice }) {
  const units = invoice.items.reduce((sum, item) => sum + item.baseUnitQuantity, 0);
  const subtotal = invoice.items.reduce((sum, item) => sum + itemTotal(item), 0);
  const discount = subtotal - invoice.total;

  return (
    <PageLayout>
      <PageHeader>
        <PageHeading>
          Invoice{" "}
          <span className="tabular-nums">#{formatInvoiceNumber(invoice.invoiceNumber)}</span>
        </PageHeading>
        <PageDescription>
          {invoice.customerName ?? "Walk-in customer"} · {format(invoice.createdAt, "d MMM yyyy")} ·{" "}
          {format(invoice.createdAt, "h:mm a")}
        </PageDescription>
        <PageAction>
          <NewSaleAction />
        </PageAction>
      </PageHeader>

      <FrameCard
        description={`${formatCount(invoice.items.length, "line")} · ${formatCount(units, "unit")}`}
        table
        title="Items"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 w-full min-w-48">Product</TableHead>
              <TableHead className="h-8">Batch</TableHead>
              <TableHead className="h-8 w-28">
                <span className="block text-end">Qty</span>
              </TableHead>
              <TableHead className="h-8 w-32">
                <span className="block text-end">Unit price</span>
              </TableHead>
              <TableHead className="h-8 w-32">
                <span className="block text-end">Total</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoice.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="max-w-0">
                  <span
                    className="block truncate leading-tight font-medium"
                    title={item.productName}
                  >
                    {item.productName}
                  </span>
                </TableCell>
                <TableCell>
                  <span
                    className="block max-w-48 truncate text-muted-foreground tabular-nums"
                    title={item.batchNumber ?? undefined}
                  >
                    {item.batchNumber ?? EMPTY}
                  </span>
                </TableCell>
                <AmountCell>
                  {formatCount(item.quantity, item.quantityType === "pack" ? "pack" : "unit")}
                </AmountCell>
                <AmountCell>{formatPrice(item.salePrice)}</AmountCell>
                <AmountCell strong>{formatPrice(itemTotal(item))}</AmountCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            {discount > 0 && (
              <>
                <TableRow>
                  <TableCell colSpan={4}>Subtotal</TableCell>
                  <AmountCell>{formatPrice(subtotal)}</AmountCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={4}>Discount</TableCell>
                  <AmountCell>{`−${formatPrice(discount)}`}</AmountCell>
                </TableRow>
              </>
            )}
            <TableRow>
              <TableCell colSpan={4}>Total</TableCell>
              <TableCell className="text-end">
                <span className="tabular-nums">{formatPrice(invoice.total)}</span>
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </FrameCard>
    </PageLayout>
  );
}

export { InvoiceDetailError, InvoiceDetailPage };
