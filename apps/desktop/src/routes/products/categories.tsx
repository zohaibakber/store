import { createFileRoute } from "@tanstack/react-router";

import { CategoriesTable } from "@/components/products/categories";
import { PageLayout } from "@/components/shared/page-layout";
import { useSuspenseCatalogCategories } from "@/lib/inventory";

export const Route = createFileRoute("/products/categories")({
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
