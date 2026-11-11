import { createFileRoute } from "@tanstack/react-router";

import { CategoriesTable } from "@/components/products/categories";
import { PageLayout } from "@/components/shared/page-layout";
import { preloadCatalogCategories } from "@/inventory/preload";
import { preloadInventory } from "@/inventory/preload";
import { useSuspenseCatalogCategories } from "@/inventory/queries";

export const Route = createFileRoute("/_app/categories")({
  loader: ({ context }) => preloadInventory(context, preloadCatalogCategories),
  component: CategoriesPage,
  staticData: { breadcrumb: "Categories" },
});

function CategoriesPage() {
  return (
    <PageLayout>
      <CategoriesTable categories={useSuspenseCatalogCategories()} />
    </PageLayout>
  );
}
