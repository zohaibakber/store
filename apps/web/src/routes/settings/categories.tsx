import { createFileRoute } from "@tanstack/react-router";

import { CategorySettings } from "@/components/settings/category-settings";
import { useCatalogCategories, useInventoryState } from "@/lib/inventory-db";

export const Route = createFileRoute("/settings/categories")({
  component: LiveCategorySettings,
  staticData: { breadcrumb: "Categories" },
});

function LiveCategorySettings() {
  const state = useInventoryState();
  if (!state || state._tag !== "Ready") return null;
  return <CategorySettingsLive inventory={state.inventory} />;
}

function CategorySettingsLive({
  inventory,
}: {
  readonly inventory: Extract<
    NonNullable<ReturnType<typeof useInventoryState>>,
    { _tag: "Ready" }
  >["inventory"];
}) {
  const categories = useCatalogCategories(inventory);
  if (categories.isError && categories.data.length === 0) {
    throw new Error("The categories could not be loaded.");
  }
  return <CategorySettings categories={categories.data} />;
}
