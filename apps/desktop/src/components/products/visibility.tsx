import type { Product } from "@store/contracts";
import { useRouter } from "@tanstack/react-router";

import { FrameCard } from "@/components/frame-card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastManager } from "@/components/ui/toast";

const visibilityOptions = [
  { value: "visible", label: "Visible" },
  { value: "hidden", label: "Hidden" },
] as const;

export function ProductVisibilityCard({ product }: { product: Product }) {
  const router = useRouter();

  const setVisible = async (next: boolean) => {
    if (next === product.visible) return;
    try {
      const {
        id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        category: _category,
        batches: _batches,
        ...rest
      } = product;
      await window.offlineStore.updateProduct({ id, ...rest, visible: next });
      toastManager.add({
        title: next ? "Product is visible to customers" : "Product hidden from customers",
        type: "success",
      });
      await router.invalidate();
    } catch (error) {
      toastManager.add({
        title: error instanceof Error ? error.message : "Could not update visibility.",
        type: "error",
      });
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
