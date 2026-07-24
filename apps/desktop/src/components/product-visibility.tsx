import { FrameCard } from "@/components/frame-card";
import type { Product } from "@store/contracts";
import { useRouter } from "@tanstack/react-router";
import { toast } from "@/lib/toast";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
      toast.success(next ? "Product is visible to customers" : "Product hidden from customers");
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update visibility.");
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
