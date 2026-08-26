import { createFileRoute } from "@tanstack/react-router";

import { CategorySettings } from "@/components/settings/category-settings";
import { useAuth } from "@/lib/auth";
import { InventoryProvider, useCatalogCategories, useInventoryState } from "@/lib/inventory-db";

export const Route = createFileRoute("/settings/categories")({
  component: CategoriesRoute,
  staticData: { breadcrumb: "Categories" },
});

function CategoriesRoute() {
  const auth = useAuth();
  const { access, inventory } = Route.useRouteContext();
  const scope = access.inventoryScope(auth.snapshot);
  if (inventory && scope) {
    return (
      <InventoryProvider
        key={`${scope.organizationId}:${scope.userId}`}
        host={inventory}
        scope={scope}
      >
        <LiveCategorySettings />
      </InventoryProvider>
    );
  }
  return <p className="p-6 text-sm text-destructive">Catalog storage is unavailable.</p>;
}

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
