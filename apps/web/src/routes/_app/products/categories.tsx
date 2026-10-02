import { preloadCatalogCategories, useSuspenseCatalogCategories } from "@store/inventory-react";
import { createFileRoute } from "@tanstack/react-router";

import { CategoriesTable } from "@/components/products/categories";
import { PageLayout } from "@/components/shared/page-layout";
import { preloadInventory } from "@/lib/inventory/preload";

export const Route = createFileRoute("/_app/products/categories")({
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
