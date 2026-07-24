import { useState } from "react";
import { DiscountIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Fieldset } from "@/components/ui/fieldset";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "@/components/ui/number-field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  paisaToRupees,
  suggestedPrice,
  useInvoiceCreate,
  type SaleLine,
} from "@/components/invoices/invoice-create-context";
import { formatPrice } from "@/lib/format";

const pricingItems = [
  { label: "Price", value: "price" },
  { label: "Discount", value: "discount" },
] as const;

function InvoicePricingDialog({ line }: { line: SaleLine }) {
  const {
    actions: { updateLine },
  } = useInvoiceCreate();
  const [open, setOpen] = useState(false);
  const [pricingMode, setPricingMode] = useState<SaleLine["pricingMode"]>(line.pricingMode);
  const [salePrice, setSalePrice] = useState(line.salePrice);
  const [discount, setDiscount] = useState(line.discount);
  const hasDiscount = line.pricingMode === "discount" && (line.discount ?? 0) > 0;
  const suggestedPaisa = suggestedPrice(line.product, line.quantityUnit);
  const originalSalePrice = paisaToRupees(suggestedPaisa);
  const hasPriceOverride =
    line.pricingMode === "price" && line.salePrice != null && line.salePrice !== originalSalePrice;
  const isModified = hasDiscount || hasPriceOverride;
  const isAtOriginal = pricingMode === "price" && salePrice === originalSalePrice;

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setPricingMode(line.pricingMode);
      setSalePrice(line.salePrice);
      setDiscount(line.discount);
    }
    setOpen(nextOpen);
  };

  const resetToOriginal = () => {
    setPricingMode("price");
    setSalePrice(originalSalePrice);
    setDiscount(0);
  };

  const save = () => {
    updateLine(line.key, { pricingMode, salePrice, discount });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            aria-label={
              hasDiscount
                ? `Edit pricing for ${line.product.name} (${line.discount}% discount applied)`
                : hasPriceOverride
                  ? `Edit pricing for ${line.product.name} (${formatPrice(Math.round(line.salePrice! * 100))} instead of ${formatPrice(suggestedPaisa)})`
                  : `Edit pricing for ${line.product.name}`
            }
            size="icon"
            variant={isModified ? "secondary" : "ghost"}
          />
        }
      >
        <HugeiconsIcon aria-hidden="true" icon={DiscountIcon} />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit pricing</DialogTitle>
          <DialogDescription>
            Set a unit price or apply a discount to {line.product.name}.
          </DialogDescription>
        </DialogHeader>
        <Fieldset className="flex w-full flex-col gap-6">
          <Field>
            <FieldLabel>Adjustment</FieldLabel>
            <ButtonGroup aria-label="Price adjustment" className="w-full">
              <Select
                items={pricingItems}
                onValueChange={(value) => value && setPricingMode(value)}
                value={pricingMode}
              >
                <SelectTrigger aria-label="Price adjustment type" className="w-24">
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
              <NumberField
                className="flex-1"
                format={{ maximumFractionDigits: 2, minimumFractionDigits: 0 }}
                max={pricingMode === "discount" ? 100 : undefined}
                min={0}
                onValueChange={(value) =>
                  pricingMode === "price" ? setSalePrice(value) : setDiscount(value)
                }
                step={pricingMode === "price" ? 0.01 : 1}
                value={pricingMode === "price" ? salePrice : discount}
              >
                <NumberFieldGroup>
                  <NumberFieldInput
                    aria-label={
                      pricingMode === "price" ? "Unit price in PKR" : "Item discount percentage"
                    }
                    className="text-right"
                  />
                  <span className="flex select-none items-center pe-3 text-muted-foreground">
                    {pricingMode === "price" ? "PKR" : "%"}
                  </span>
                </NumberFieldGroup>
              </NumberField>
            </ButtonGroup>
          </Field>
        </Fieldset>
        <DialogFooter>
          <Button
            className="sm:mr-auto"
            disabled={isAtOriginal}
            onClick={resetToOriginal}
            variant="ghost"
          >
            Reset to original
          </Button>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={save}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { InvoicePricingDialog };
