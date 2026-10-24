import { ArrowRight01Icon, Invoice01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
import { useSuspenseInventoryInvoices } from "@store/inventory-react";
import { formatPrice } from "@store/services/format";
import { Link } from "@tanstack/react-router";

import { FrameCard } from "@/components/shared/frame-card";
import { Button } from "@/components/ui/button";
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
import { formatRelativeTime } from "@/lib/format";

import { RECENT_INVOICE_LIMIT } from "./presentation";

export function RecentInvoices() {
  const invoices = useSuspenseInventoryInvoices(RECENT_INVOICE_LIMIT);
  return (
    <FrameCard
      action={
        <Button render={<Link to="/invoices" />} size="xs" variant="ghost">
          View all
          <HugeiconsIcon aria-hidden="true" icon={ArrowRight01Icon} />
        </Button>
      }
      flush={invoices.length === 0}
      table={invoices.length > 0}
      title="Recent invoices"
    >
      {invoices.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon aria-hidden="true" icon={Invoice01Icon} />
            </EmptyMedia>
            <EmptyTitle>No invoices yet</EmptyTitle>
            <EmptyDescription>Completed sales show up here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table aria-label="Recent invoices">
          <TableHeader>
            <TableRow>
              <TableHead className="h-8">Invoice</TableHead>
              <TableHead className="h-8">Customer</TableHead>
              <TableHead className="h-8">
                <div className="text-right">When</div>
              </TableHead>
              <TableHead className="h-8">
                <div className="text-right">Total</div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell>
                  <Link
                    className="font-medium tabular-nums outline-none before:absolute before:inset-0 focus-visible:underline"
                    params={{ invoiceId: invoice.id }}
                    to="/invoices/$invoiceId"
                  >
                    #{formatInvoiceNumber(invoice.invoiceNumber)}
                  </Link>
                </TableCell>
                <TableCell className="w-full">
                  <div
                    className={
                      invoice.customerName
                        ? "w-0 min-w-full truncate leading-tight"
                        : "w-0 min-w-full truncate leading-tight text-muted-foreground"
                    }
                  >
                    {invoice.customerName ?? "Walk-in customer"}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-right text-muted-foreground tabular-nums">
                    {formatRelativeTime(invoice.createdAt)}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-right tabular-nums">{formatPrice(invoice.total)}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </FrameCard>
  );
}
