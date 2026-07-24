import {
  ControlGroup,
  ControlGroupAddon,
  ControlGroupNumberInput,
  ControlGroupText,
} from "@/components/control-group";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Fieldset } from "@/components/ui/fieldset";
import { Input } from "@/components/ui/input";
import { useInvoiceCreate } from "@/components/invoices/invoice-create-context";
import { formatPrice } from "@/lib/format";

function InvoiceCompleteSaleAction() {
  const {
    actions: { completeSale },
    meta: { canSubmit, total },
  } = useInvoiceCreate();

  return (
    <Button disabled={!canSubmit} onClick={() => void completeSale()} type="button">
      Complete sale{canSubmit && ` · ${formatPrice(total)}`}
    </Button>
  );
}

function InvoiceCheckout() {
  const {
    state: { bulkDiscount, customerName, lines },
    actions: { setBulkDiscount, setCustomerName },
    meta: { discountTotal, subtotal, total, validBulkDiscount },
  } = useInvoiceCreate();
  const itemCount = lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0);

  return (
    <div className="flex flex-wrap items-start justify-between gap-6 border rounded-2xl p-6">
      <Fieldset className="space-y-4">
        <Field>
          <FieldLabel htmlFor="customer-name">Customer</FieldLabel>
          <Input
            id="customer-name"
            onChange={(event) => setCustomerName(event.target.value)}
            placeholder="Walk-in customer"
            value={customerName}
          />
        </Field>
        <Field data-invalid={!validBulkDiscount || undefined}>
          <FieldLabel htmlFor="bulk-discount">Bulk discount</FieldLabel>
          <ControlGroup>
            <ControlGroupNumberInput
              id="bulk-discount"
              inputProps={{ "aria-label": "Bulk discount percentage" }}
              max={100}
              min={0}
              onValueChange={setBulkDiscount}
              value={bulkDiscount}
            />
            <ControlGroupAddon>
              <ControlGroupText>%</ControlGroupText>
            </ControlGroupAddon>
          </ControlGroup>
          {!validBulkDiscount && (
            <FieldError match>Enter a discount between 0% and 100%.</FieldError>
          )}
        </Field>
      </Fieldset>
      <div className="ml-auto flex flex-col items-end mt-auto">
        <div className="grid min-w-40 grid-cols-2 gap-x-6 gap-y-1 text-right">
          <span className="text-muted-foreground">Items</span>
          <span className="tabular-nums font-mono">
            {lines.length === 0
              ? "—"
              : `${lines.length} ${lines.length === 1 ? "line" : "lines"} · ${itemCount}`}
          </span>
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-mono tabular-nums">{formatPrice(subtotal)}</span>
          <span className="text-muted-foreground">Discount</span>
          <span className="font-mono tabular-nums">
            {bulkDiscount != null && bulkDiscount > 0 ? `−${formatPrice(discountTotal)}` : "–"}
          </span>
          <span className="font-medium text-lg">Total</span>
          <span className="font-medium text-lg font-mono tabular-nums">{formatPrice(total)}</span>
        </div>
      </div>
    </div>
  );
}

export { InvoiceCheckout, InvoiceCompleteSaleAction };
