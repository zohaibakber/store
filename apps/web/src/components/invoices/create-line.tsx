import { ArrowDown01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  AUTO_BATCH,
  lineTotal,
  paisaToRupees,
  suggestedPrice,
  useInvoiceCreate,
  type SaleLine,
} from "@/components/invoices/create-context";
import {
  ControlGroup,
  ControlGroupAddon,
  ControlGroupNumberInput,
  ControlGroupText,
  controlGroupSelectTrigger,
} from "@/components/shared/control-group";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldLabel } from "@/components/ui/field";
import { Frame, FrameHeader, FramePanel } from "@/components/ui/frame";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPrice } from "@/lib/format";

const quantityItems = [
  { label: "Unit", value: "unit" },
  { label: "Pack", value: "pack" },
] as const;

// A product whose category is not sold in packs has nothing to choose between.
const quantityItemsFor = (line: SaleLine) =>
  line.product.category.tracksPacks ? quantityItems : quantityItems.slice(0, 1);

const pricingItems = [
  { label: "Price", value: "price" },
  { label: "Discount", value: "discount" },
] as const;

function InvoiceCreateLine({ error, line }: { error: string | null; line: SaleLine }) {
  const {
    actions: { removeLine, setLineQuantityUnit, updateLine },
  } = useInvoiceCreate();

  const total = lineTotal(line);
  const suggestedPaisa = suggestedPrice(line.product, line.quantityUnit);
  const hasDiscount = line.pricingMode === "discount" && (line.discount ?? 0) > 0;
  const hasPriceOverride =
    line.pricingMode === "price" &&
    line.salePrice != null &&
    line.salePrice !== paisaToRupees(suggestedPaisa);
  const batchItems: ReadonlyArray<{ label: string; value: SaleLine["batchId"] }> = [
    { label: "Auto (earliest expiry)", value: AUTO_BATCH },
    ...line.product.batches
      .filter((batch) =>
        line.quantityUnit === "pack"
          ? batch.packQuantity > 0
          : batch.packQuantity * line.product.unitsPerPack + batch.unitQuantity > 0,
      )
      .map((batch) => ({ label: batch.batchNumber ?? "Unnumbered", value: batch.id })),
  ];

  return (
    <Frame className="w-full">
      <Collapsible>
        <FrameHeader className="flex-row items-center gap-3 px-2 py-2">
          <CollapsibleTrigger
            className="data-panel-open:[&_svg]:rotate-180"
            render={<Button className="min-w-0 flex-1 justify-start" variant="ghost" />}
          >
            <HugeiconsIcon
              aria-hidden="true"
              className="size-4 transition-transform"
              icon={ArrowDown01Icon}
            />
            <span className="truncate capitalize">{line.product.name}</span>
            {line.product.strength && (
              <span className="text-muted-foreground">{line.product.strength}</span>
            )}
            {hasDiscount ? (
              <Badge variant="secondary">-{line.discount}%</Badge>
            ) : hasPriceOverride && line.salePrice != null ? (
              <Badge variant="secondary">{formatPrice(Math.round(line.salePrice * 100))}</Badge>
            ) : null}
          </CollapsibleTrigger>

          <ControlGroup className="w-40">
            <ControlGroupNumberInput
              aria-label="Quantity"
              inputProps={{ "aria-label": "Quantity" }}
              min={1}
              onValueChange={(quantity) => updateLine(line.key, { quantity })}
              step={1}
              value={line.quantity}
            />
            <ControlGroupAddon>
              <Select
                items={quantityItemsFor(line)}
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
                    {quantityItemsFor(line).map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </ControlGroupAddon>
          </ControlGroup>

          <span className="min-w-24 text-right font-mono font-medium tabular-nums">
            {total == null ? "—" : formatPrice(total)}
          </span>

          <Button
            aria-label={`Remove ${line.product.name}`}
            onClick={() => removeLine(line.key)}
            size="icon"
            variant="ghost"
          >
            <HugeiconsIcon aria-hidden="true" icon={Delete02Icon} />
          </Button>
        </FrameHeader>

        <CollapsiblePanel>
          <FramePanel className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>Batch</FieldLabel>
              <Select<SaleLine["batchId"]>
                items={batchItems}
                onValueChange={(value) => {
                  if (value) updateLine(line.key, { batchId: value });
                }}
                value={line.batchId}
              >
                <SelectTrigger aria-label="Batch">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {batchItems.map((batch) => (
                      <SelectItem key={batch.value} value={batch.value}>
                        {batch.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>Adjustment</FieldLabel>
              <ControlGroup>
                <ControlGroupAddon align="inline-start">
                  <Select
                    items={pricingItems}
                    onValueChange={(value) => value && updateLine(line.key, { pricingMode: value })}
                    value={line.pricingMode}
                  >
                    <SelectTrigger
                      aria-label="Price adjustment type"
                      className={controlGroupSelectTrigger}
                      size="sm"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {pricingItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </ControlGroupAddon>
                <ControlGroupNumberInput
                  format={{ maximumFractionDigits: 2, minimumFractionDigits: 0 }}
                  inputProps={{
                    "aria-label":
                      line.pricingMode === "price"
                        ? "Unit price in PKR"
                        : "Item discount percentage",
                    className: "text-right",
                  }}
                  max={line.pricingMode === "discount" ? 100 : undefined}
                  min={0}
                  onValueChange={(value) =>
                    updateLine(
                      line.key,
                      line.pricingMode === "price" ? { salePrice: value } : { discount: value },
                    )
                  }
                  step={line.pricingMode === "price" ? 0.01 : 1}
                  value={line.pricingMode === "price" ? line.salePrice : line.discount}
                />
                <ControlGroupAddon>
                  <ControlGroupText>{line.pricingMode === "price" ? "PKR" : "%"}</ControlGroupText>
                </ControlGroupAddon>
              </ControlGroup>
            </Field>
          </FramePanel>
        </CollapsiblePanel>
      </Collapsible>

      {error && <p className="px-4 pb-2 text-xs text-destructive-foreground">{error}</p>}
    </Frame>
  );
}

export { InvoiceCreateLine };
