import type { Product } from "@store/contracts";
import { useCommand } from "@store/inventory-react";
import * as Exit from "effect/Exit";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastManager } from "@/components/ui/toast";
import { toastFailure } from "@/lib/errors";

const visibilityOptions = [
  { value: "visible", label: "Visible to customers" },
  { value: "hidden", label: "Hidden from customers" },
] as const;

export function ProductVisibilitySelect({ product }: { product: Product }) {
  const [updateProduct] = useCommand((commands) => commands.updateProduct);

  const setVisible = async (next: boolean) => {
    if (next === product.visible) return;
    const exit = await updateProduct({
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
    if (Exit.isFailure(exit)) {
      toastFailure(exit.cause);
      return;
    }
    toastManager.add({
      title: next ? "Product is visible to customers" : "Product hidden from customers",
      type: "success",
    });
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
