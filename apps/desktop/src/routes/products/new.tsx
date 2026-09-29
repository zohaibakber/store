import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { useProductCreateForm } from "@/components/products/form";
import { ProductFormPage } from "@/components/products/form-page";
import {
  preloadAll,
  preloadCatalogCategories,
  preloadInventory,
  preloadProductFacets,
  useSuspenseCatalogSuggestions,
  useSuspenseCatalogCategories,
} from "@/lib/inventory";

export const Route = createFileRoute("/products/new")({
  loader: ({ context }) =>
    preloadInventory(context, (inventory) =>
      preloadAll([preloadCatalogCategories(inventory), preloadProductFacets(inventory)]),
    ),
  component: NewProductPage,
  staticData: { breadcrumb: "Add product" },
});

function NewProductPage() {
  const categories = useSuspenseCatalogCategories();
  const suggestions = useSuspenseCatalogSuggestions();
  return <NewProductForm categories={categories} suggestions={suggestions} />;
}

function NewProductForm({
  categories,
  suggestions,
}: {
  readonly categories: Parameters<typeof useProductCreateForm>[0];
  readonly suggestions: React.ComponentProps<typeof ProductFormPage>["suggestions"];
}) {
  const form = useProductCreateForm(categories);
  const navigate = useNavigate();

  return (
    <ProductFormPage
      onCancel={() => void navigate({ to: "/products" })}
      categories={categories}
      form={form}
      formId="new-product-form"
      submitLabel="Create product"
      suggestions={suggestions}
      title="Add product"
    />
  );
}
