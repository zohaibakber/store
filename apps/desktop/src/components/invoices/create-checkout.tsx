import { MAX_CATALOG_NAME_LENGTH } from "@store/contracts";
import { formatPrice } from "@store/services/format";

import { useInvoiceCreate } from "@/components/invoices/create-context";
import { NumberControl } from "@/components/shared/control-group";
import { FrameCard } from "@/components/shared/frame-card";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { EMPTY, formatCount } from "@/lib/format";

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function InvoiceCheckout() {
  const {
    state: { bulkDiscount, customerName, lines },
    actions: { completeSale, setBulkDiscount, setCustomerName },
    meta: { canSubmit, discountTotal, isSubmitting, subtotal, total, unitCount, validBulkDiscount },
  } = useInvoiceCreate();

  return (
    <FrameCard title="Summary">
      <div className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="customer-name">Customer</FieldLabel>
          <Input
            id="customer-name"
            maxLength={MAX_CATALOG_NAME_LENGTH}
            onChange={(event) => setCustomerName(event.target.value)}
            placeholder="Walk-in customer"
            value={customerName}
          />
        </Field>
        <Field data-invalid={!validBulkDiscount || undefined}>
          <FieldLabel htmlFor="bulk-discount">Bulk discount</FieldLabel>
          <NumberControl
            addon="%"
            id="bulk-discount"
            inputProps={{ "aria-label": "Bulk discount percentage" }}
            max={100}
            min={0}
            onValueChange={setBulkDiscount}
            value={bulkDiscount}
          />
          {!validBulkDiscount && (
            <FieldError match>Enter a discount between 0% and 100%.</FieldError>
          )}
        </Field>

        <Separator />

        <dl className="flex flex-col gap-1.5 text-sm">
          <SummaryRow
            label="Items"
            value={
              lines.length === 0
                ? EMPTY
                : `${formatCount(lines.length, "line")} · ${formatCount(unitCount, "unit")}`
            }
          />
          <SummaryRow label="Subtotal" value={formatPrice(subtotal)} />
          <SummaryRow
            label="Discount"
            value={discountTotal > 0 ? `−${formatPrice(discountTotal)}` : EMPTY}
          />
          <div className="mt-2 flex items-baseline justify-between gap-4">
            <dt className="text-base font-medium">Total</dt>
            <dd className="text-2xl font-medium tabular-nums">{formatPrice(total)}</dd>
          </div>
        </dl>

        <Button
          aria-keyshortcuts="Control+Enter"
          className="w-full"
          disabled={!canSubmit || isSubmitting}
          loading={isSubmitting}
          onClick={() => void completeSale()}
          size="lg"
          type="button"
        >
          Complete sale
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <Kbd>Enter</Kbd>
          </KbdGroup>
        </Button>
      </div>
    </FrameCard>
  );
}

export { InvoiceCheckout };
