import type { Product } from "@store/contracts";

import { FrameCard } from "@/components/shared/frame-card";
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
import { useInventoryActions } from "@/lib/inventory-db";

const visibilityOptions = [
  { value: "visible", label: "Visible" },
  { value: "hidden", label: "Hidden" },
] as const;

export function ProductVisibilityCard({ product }: { product: Product }) {
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
    <FrameCard
      description={
        product.visible
          ? "Shown in the catalog and at checkout."
          : "Hidden from the catalog and checkout."
      }
      title="Visibility"
    >
      <Select
        items={visibilityOptions}
        onValueChange={(value) => value && void setVisible(value === "visible")}
        value={product.visible ? "visible" : "hidden"}
      >
        <SelectTrigger className="w-full">
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
    </FrameCard>
  );
}
