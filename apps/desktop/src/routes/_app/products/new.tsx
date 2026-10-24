import {
  preloadAll,
  preloadCatalogCategories,
  preloadProductFacets,
  useSuspenseCatalogSuggestions,
  useSuspenseCatalogCategories,
} from "@store/inventory-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { ProductPrefill, useProductCreateForm } from "@/components/products/form";
import { ProductFormPage } from "@/components/products/form-page";
import { preloadInventory } from "@/lib/inventory/preload";

export const Route = createFileRoute("/_app/products/new")({
  validateSearch: Schema.toStandardSchemaV1(ProductPrefill),
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
  const prefill = Route.useSearch();
  return (
    <NewProductForm
      categories={categories}
      key={[prefill.name, prefill.composition, prefill.strength, prefill.unitsPerPack].join("\n")}
      prefill={prefill}
      suggestions={suggestions}
    />
  );
}

function NewProductForm({
  categories,
  prefill,
  suggestions,
}: {
  readonly categories: Parameters<typeof useProductCreateForm>[0];
  readonly prefill: ProductPrefill;
  readonly suggestions: React.ComponentProps<typeof ProductFormPage>["suggestions"];
}) {
  const form = useProductCreateForm(categories, prefill);
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
