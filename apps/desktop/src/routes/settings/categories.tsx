import { createFileRoute } from "@tanstack/react-router";

import { CategorySettings } from "@/components/settings/category-settings";
import { useSuspenseCatalogCategories } from "@/lib/inventory";

export const Route = createFileRoute("/settings/categories")({
  component: LiveCategorySettings,
  staticData: { breadcrumb: "Categories" },
});

function LiveCategorySettings() {
  return <CategorySettings categories={useSuspenseCatalogCategories()} />;
}
