import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { ProductDetailError, ProductDetailPage } from "@/components/products/detail-page";
import { toastManager } from "@/components/ui/toast";
import { toastStoreError } from "@/lib/errors";
import { formValidator } from "@/lib/form-schema";
import {
  preloadAll,
  preloadCatalogProduct,
  preloadInventory,
  preloadProductStockPlan,
  preloadStockMovementHistory,
  useInventoryActions,
  useSuspenseCatalogProduct,
  useSuspenseStockMovementHistory,
} from "@/lib/inventory";
import { lenientSearchParam } from "@/lib/search-param";

const productSearch = formValidator(
  Schema.Struct({ addStock: lenientSearchParam(Schema.Boolean) }),
);

export const Route = createFileRoute("/_app/products/$productId")({
  loader: ({ context, params }) =>
    preloadInventory(context, (inventory) =>
      preloadAll([
        preloadCatalogProduct(inventory, params.productId),
        preloadStockMovementHistory(inventory, params.productId),
        preloadProductStockPlan(inventory, params.productId),
      ]),
    ),
  validateSearch: productSearch,
  component: ProductDetailRoute,
  errorComponent: ProductDetailError,
  staticData: { breadcrumb: "Product" },
});

function ProductDetailRoute() {
  const { productId } = Route.useParams();
  const { addStock } = Route.useSearch();
  const catalogProduct = useSuspenseCatalogProduct(productId);
  const movements = useSuspenseStockMovementHistory(productId);
  const { deleteProduct } = useInventoryActions();
  const navigate = useNavigate();

  if (!catalogProduct) throw new Error(`Product ${productId} was not found.`);

  const removeProduct = async () => {
    try {
      await deleteProduct(catalogProduct.id);
      toastManager.add({ title: `${catalogProduct.name} deleted`, type: "success" });
      await navigate({ to: "/products" });
    } catch (error) {
      toastStoreError(error, "Could not delete the product.");
    }
  };

  return (
    <ProductDetailPage
      addStockOpen={addStock === true}
      movements={movements}
      onAddStockOpenChange={(open) =>
        void navigate({
          to: "/products/$productId",
          params: { productId },
          search: open ? { addStock: true } : {},
          replace: true,
        })
      }
      onDelete={removeProduct}
      onEdit={() =>
        void navigate({ to: "/products/$productId/edit", params: { productId: catalogProduct.id } })
      }
      product={catalogProduct}
    />
  );
}
