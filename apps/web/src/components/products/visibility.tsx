import type { Product } from "@store/contracts";
import { useRouter } from "@tanstack/react-router";

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
import { useStore } from "@/lib/store";

const visibilityOptions = [
  { value: "visible", label: "Visible" },
  { value: "hidden", label: "Hidden" },
] as const;

export function ProductVisibilityCard({ product }: { product: Product }) {
  const store = useStore();
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
      await store.updateProduct({ id, ...rest, visible: next });
      toastManager.add({
        title: next ? "Product is visible to customers" : "Product hidden from customers",
        type: "success",
      });
      await router.invalidate();
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
