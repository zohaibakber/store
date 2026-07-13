import { Button } from "@/components/ui/button";
import { CardFooter } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NumberField,
  NumberFieldAddon,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "@/components/ui/number-field";
import { useInvoiceCreate } from "@/components/invoices/invoice-create-context";
import { formatPrice } from "@/lib/format";

function InvoiceCheckout() {
  const {
    state: { bulkDiscount, customerName },
    actions: { completeSale, setBulkDiscount, setCustomerName },
    meta: { canSubmit, discountTotal, subtotal, total, validBulkDiscount },
  } = useInvoiceCreate();

  return (
    <CardFooter className="flex-wrap items-start justify-between gap-6 border-t">
      <FieldGroup className="max-w-64">
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
          <NumberField
            className="w-full"
            id="bulk-discount"
            max={100}
            min={0}
            onValueChange={setBulkDiscount}
            value={bulkDiscount}
          >
            <NumberFieldGroup>
              <NumberFieldDecrement aria-label="Decrease bulk discount" />
              <NumberFieldInput aria-label="Bulk discount percentage" />
              <NumberFieldAddon align="inline-end">%</NumberFieldAddon>
              <NumberFieldIncrement aria-label="Increase bulk discount" />
            </NumberFieldGroup>
          </NumberField>
        </Field>
      </FieldGroup>
      <div className="ml-auto flex flex-col items-end gap-4">
        <div className="grid min-w-40 grid-cols-2 gap-x-6 gap-y-1 text-right">
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
            Complete sale
          </Button>
        </div>
      </div>
    </CardFooter>
  );
}

export { InvoiceCheckout };
