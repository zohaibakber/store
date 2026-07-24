import {
  ControlGroup,
  ControlGroupAddon,
  ControlGroupNumberInput,
  ControlGroupText,
} from "@/components/control-group";
import { Button } from "@/components/ui/button";
import { CardFooter } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Fieldset } from "@/components/ui/fieldset";
import { Input } from "@/components/ui/input";
import { NumberFieldDecrement, NumberFieldIncrement } from "@/components/ui/number-field";
import { useInvoiceCreate } from "@/components/invoices/invoice-create-context";
import { formatPrice } from "@/lib/format";

function InvoiceCheckout() {
  const {
    state: { bulkDiscount, customerName, lines },
    actions: { completeSale, setBulkDiscount, setCustomerName },
    meta: { canSubmit, discountTotal, subtotal, total, validBulkDiscount },
  } = useInvoiceCreate();
  const itemCount = lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0);

  return (
    <CardFooter className="flex-wrap items-start justify-between gap-6 border-t">
      <Fieldset className="flex w-full max-w-64 flex-col gap-6">
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
            >
              <ControlGroupAddon className="gap-0">
                <ControlGroupText className="pe-1">%</ControlGroupText>
                <NumberFieldDecrement
                  aria-label="Decrease bulk discount"
                  className="rounded-md px-2"
                />
                <NumberFieldIncrement
                  aria-label="Increase bulk discount"
                  className="rounded-md px-2"
                />
              </ControlGroupAddon>
            </ControlGroupNumberInput>
          </ControlGroup>
          {!validBulkDiscount && (
            <FieldError match>Enter a discount between 0% and 100%.</FieldError>
          )}
        </Field>
      </Fieldset>
      <div className="ml-auto flex flex-col items-end gap-4">
        <div className="grid min-w-40 grid-cols-2 gap-x-6 gap-y-1 text-right">
          <span className="text-muted-foreground">Items</span>
          <span className="tabular-nums">
            {lines.length === 0
              ? "—"
              : `${lines.length} ${lines.length === 1 ? "line" : "lines"} · ${itemCount}`}
          </span>
          <span className="text-muted-foreground">Subtotal</span>
          <span>{formatPrice(subtotal)}</span>
          <span className="text-muted-foreground">Discount</span>
          <span>
            {bulkDiscount != null && bulkDiscount > 0 ? `−${formatPrice(discountTotal)}` : "–"}
          </span>
          <span className="font-medium">Total</span>
          <span className="font-medium">{formatPrice(total)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button disabled={!canSubmit} onClick={() => void completeSale()}>
            Complete sale{canSubmit && ` · ${formatPrice(total)}`}
          </Button>
        </div>
      </div>
    </CardFooter>
  );
}

export { InvoiceCheckout };
