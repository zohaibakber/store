import type { Product } from "@store/contracts";
import { useInventoryActions } from "@store/inventory-react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastManager } from "@/components/ui/toast";
import { toastStoreError } from "@/lib/errors";

const visibilityOptions = [
  { value: "visible", label: "Visible to customers" },
  { value: "hidden", label: "Hidden from customers" },
] as const;

export function ProductVisibilitySelect({ product }: { product: Product }) {
  const { updateProduct } = useInventoryActions();

  const setVisible = async (next: boolean) => {
    if (next === product.visible) return;
    try {
      await updateProduct({
        id: product.id,
        name: product.name,
        categoryId: product.categoryId,
        aisle: product.aisle,
        composition: product.composition,
        strength: product.strength,
        unitsPerPack: product.unitsPerPack,
        purchasePrice: product.purchasePrice,
        retailPrice: product.retailPrice,
        unitPrice: product.unitPrice,
        visible: next,
      });
      toastManager.add({
        title: next ? "Product is visible to customers" : "Product hidden from customers",
        type: "success",
      });
    } catch (error) {
      toastStoreError(error, "Could not update visibility.");
    }
  };

  return (
    <Select
      items={visibilityOptions}
      onValueChange={(value) => value && void setVisible(value === "visible")}
      value={product.visible ? "visible" : "hidden"}
    >
      <SelectTrigger aria-label="Visibility" className="w-auto min-w-0" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {visibilityOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
