import { createFileRoute } from "@tanstack/react-router";

import { CategorySettings } from "@/components/settings/category-settings";
import { useCatalogCategories } from "@/lib/inventory-db";

export const Route = createFileRoute("/settings/categories")({
  component: LiveCategorySettings,
  staticData: { breadcrumb: "Categories" },
});

function LiveCategorySettings() {
  const categories = useCatalogCategories();
  if (categories.isError && categories.data.length === 0) {
    throw new Error("The categories could not be loaded.");
  }
  return <CategorySettings categories={categories.data} />;
}
