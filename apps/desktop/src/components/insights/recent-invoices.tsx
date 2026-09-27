import { ArrowRight01Icon, Invoice01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
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
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { formatRelativeTime } from "@/lib/format";
import { useSuspenseInventoryInvoices } from "@/lib/inventory";

export function RecentInvoices() {
  const invoices = useSuspenseInventoryInvoices(5);
  return (
    <FrameCard
      action={
        <Button render={<Link to="/invoices" />} size="sm" variant="ghost">
          View all
          <HugeiconsIcon aria-hidden="true" icon={ArrowRight01Icon} />
        </Button>
      }
      description="The latest sales recorded on this device."
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
        <Table>
          <TableBody>
            {invoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell>
                  <span className="font-medium">
                    <Link
                      className="tabular-nums hover:underline"
                      params={{ invoiceId: invoice.id }}
                      to="/invoices/$invoiceId"
                    >
                      #{formatInvoiceNumber(invoice.invoiceNumber)}
                    </Link>
                  </span>
                </TableCell>
                <TableCell className="w-full">
                  <span className="block max-w-32 truncate text-muted-foreground sm:max-w-56">
                    {invoice.customerName ?? "Walk-in customer"}
                  </span>
                </TableCell>
                <TableCell className="max-sm:hidden">
                  <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {formatRelativeTime(invoice.createdAt)}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="whitespace-nowrap tabular-nums">
                    {formatPrice(invoice.total)}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </FrameCard>
  );
}
