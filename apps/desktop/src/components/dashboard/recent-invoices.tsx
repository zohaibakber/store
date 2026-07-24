import { FrameCard } from "@/components/frame-card";
import type { DashboardAnalytics } from "@store/contracts";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
import { ArrowRight01Icon, Invoice01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { formatPrice, formatRelativeTime } from "@/lib/format";

export function RecentInvoices({ invoices }: { invoices: DashboardAnalytics["recentInvoices"] }) {
  return (
    <FrameCard
      action={
        <Link className={buttonVariants({ size: "sm", variant: "ghost" })} to="/invoices">
          View all
          <HugeiconsIcon aria-hidden="true" icon={ArrowRight01Icon} />
        </Link>
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
            <EmptyDescription>Completed sales will appear here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableBody>
            {invoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell className="font-medium">
                  <Link
                    className="font-mono tabular-nums hover:underline"
                    params={{ invoiceId: invoice.id }}
                    to="/invoices/$invoiceId"
                  >
                    #{formatInvoiceNumber(invoice.invoiceNumber)}
                  </Link>
                </TableCell>
                <TableCell className="w-full text-muted-foreground">
                  <span className="block max-w-56 truncate">
                    {invoice.customerName ?? "Walk-in customer"}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-muted-foreground tabular-nums">
                  {formatRelativeTime(invoice.createdAt)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                  {formatPrice(invoice.total)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </FrameCard>
  );
}
