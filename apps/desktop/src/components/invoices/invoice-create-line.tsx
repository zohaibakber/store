import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ControlGroup,
  ControlGroupAddon,
  ControlGroupNumberInput,
  controlGroupSelectTrigger,
} from "@/components/control-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemTitle,
} from "@/components/ui/item";
import { NumberFieldDecrement, NumberFieldIncrement } from "@/components/ui/number-field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AUTO_BATCH,
  lineTotal,
  paisaToRupees,
  suggestedPrice,
  useInvoiceCreate,
  type SaleLine,
} from "@/components/invoices/invoice-create-context";
import { InvoicePricingDialog } from "@/components/invoices/invoice-pricing-dialog";
import { formatPrice } from "@/lib/format";

const quantityItems = [
  { label: "Unit", value: "unit" },
  { label: "Pack", value: "pack" },
] as const;

// What this line contributes to the sale, with the pre-discount figure struck
// through when a per-line price or discount moved it. Fixed width so the
// column lines up across rows.
function LineTotal({ line }: { line: SaleLine }) {
  const total = lineTotal(line);
  const suggestedPaisa = suggestedPrice(line.product, line.quantityUnit);
  const original =
    line.quantity != null && suggestedPaisa != null ? line.quantity * suggestedPaisa : null;

  return (
    <div className="flex min-w-24 flex-col items-end justify-center">
      <span className="font-medium tabular-nums">{total == null ? "—" : formatPrice(total)}</span>
      {original != null && total != null && original !== total && (
        <span className="text-muted-foreground text-xs line-through tabular-nums">
          {formatPrice(original)}
        </span>
      )}
    </div>
  );
}

function InvoiceCreateLine({ error, line }: { error: string | null; line: SaleLine }) {
  const {
    actions: { removeLine, setLineQuantityUnit, updateLine },
  } = useInvoiceCreate();
  const hasDiscount = line.pricingMode === "discount" && (line.discount ?? 0) > 0;
  const suggestedPaisa = suggestedPrice(line.product, line.quantityUnit);
  const hasPriceOverride =
    line.pricingMode === "price" &&
    line.salePrice != null &&
    line.salePrice !== paisaToRupees(suggestedPaisa);
  const batchItems = [
    { label: "Auto", value: AUTO_BATCH },
    ...line.product.batches
      .filter((batch) =>
        line.quantityUnit === "pack"
          ? batch.packQuantity > 0
          : batch.packQuantity * line.product.unitsPerPack + batch.unitQuantity > 0,
      )
      .map((batch) => ({
        label: batch.batchNumber ?? "Unnumbered",
        value: batch.id,
      })),
  ];

  return (
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>
          {line.product.name}
          {hasDiscount && <Badge variant="secondary">-{line.discount}%</Badge>}
          {hasPriceOverride && (
            <Badge variant="outline">
              <span className="text-muted-foreground line-through">
                {formatPrice(suggestedPaisa)}
              </span>
              {formatPrice(Math.round(line.salePrice! * 100))}
            </Badge>
          )}
        </ItemTitle>
        <div className="flex items-center gap-1">
          {line.product.strength && (
            <>
              <ItemDescription>{line.product.strength}</ItemDescription>
              <span className="text-muted-foreground">/</span>
            </>
          )}
          <Select
            items={batchItems}
            onValueChange={(value) => value && updateLine(line.key, { batchId: value })}
            value={line.batchId}
          >
            <SelectTrigger
              aria-label="Batch"
              className="w-auto min-w-0 border-0 bg-transparent! px-px shadow-none"
              size="sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                <SelectLabel>Batch</SelectLabel>
                <SelectSeparator />
                {batchItems.map((batch) => (
                  <SelectItem key={batch.value} value={batch.value}>
                    {batch.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </ItemContent>
      <ItemActions className="flex-wrap justify-end">
        <LineTotal line={line} />
        <ControlGroup className="w-44">
          <ControlGroupAddon align="inline-start">
            <Select
              items={quantityItems}
              onValueChange={(value) => value && setLineQuantityUnit(line.key, value)}
              value={line.quantityUnit}
            >
              <SelectTrigger
                aria-label="Quantity unit"
                className={controlGroupSelectTrigger}
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {quantityItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </ControlGroupAddon>
          <ControlGroupNumberInput
            aria-label="Quantity"
            inputProps={{ "aria-label": "Quantity" }}
            min={1}
            onValueChange={(quantity) => updateLine(line.key, { quantity })}
            step={1}
            value={line.quantity}
          >
            <ControlGroupAddon className="gap-0">
              <NumberFieldDecrement aria-label="Decrease quantity" className="rounded-md px-2" />
              <NumberFieldIncrement aria-label="Increase quantity" className="rounded-md px-2" />
            </ControlGroupAddon>
          </ControlGroupNumberInput>
        </ControlGroup>
        <InvoicePricingDialog line={line} />
        <Button
          aria-label={`Remove ${line.product.name}`}
          onClick={() => removeLine(line.key)}
          size="icon"
          variant="ghost"
          className={"-ml-2"}
        >
          <HugeiconsIcon aria-hidden="true" icon={Delete02Icon} />
        </Button>
      </ItemActions>
      {error && <ItemFooter className="justify-end text-destructive">{error}</ItemFooter>}
    </Item>
  );
}

export { InvoiceCreateLine };
