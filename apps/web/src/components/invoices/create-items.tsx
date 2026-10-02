import { useInvoiceCreate } from "@/components/invoices/create-context";
import { InvoiceCreateLine, InvoiceMissingLine } from "@/components/invoices/create-line";
import { InvoiceProductPicker } from "@/components/invoices/product-picker";
import { FrameCard } from "@/components/shared/frame-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount } from "@/lib/format";

function InvoiceItems() {
  const {
    state: { lines },
    meta: { errors, unitCount },
  } = useInvoiceCreate();

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <InvoiceProductPicker />
      <FrameCard
        description={
          lines.length > 0
            ? `${formatCount(lines.length, "line")} · ${formatCount(unitCount, "unit")}`
            : undefined
        }
        table
        title="Items"
      >
        <Table className="table-fixed" variant="card">
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 w-8">
                <span className="block text-end">#</span>
              </TableHead>
              <TableHead className="h-8">Product</TableHead>
              <TableHead className="h-8 w-32">Batch</TableHead>
              <TableHead className="h-8 w-36">Qty</TableHead>
              <TableHead className="h-8 w-36">
                <span className="block text-end">Price</span>
              </TableHead>
              <TableHead className="h-8 w-28">
                <span className="block text-end">Total</span>
              </TableHead>
              <TableHead className="h-8 w-10">
                <span className="sr-only">Remove</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 ? (
              <TableRow>
                <TableCell className="h-16" colSpan={7}>
                  <p className="text-center whitespace-normal text-muted-foreground">
                    No items yet. Search above and press Enter to add.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              lines.map((line, index) =>
                line.kind === "ready" ? (
                  <InvoiceCreateLine
                    error={errors[index] ?? null}
                    index={index}
                    key={line.key}
                    line={line}
                  />
                ) : (
                  <InvoiceMissingLine index={index} key={line.key} line={line} />
                ),
              )
            )}
          </TableBody>
        </Table>
      </FrameCard>
    </div>
  );
}

export { InvoiceItems };
