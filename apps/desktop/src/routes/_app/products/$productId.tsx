import { decodeProductId } from "@store/contracts";
import {
  preloadAll,
  preloadCatalogProduct,
  preloadProductStockPlan,
  preloadStockMovementHistory,
  useCommand,
  useSuspenseCatalogProduct,
  useSuspenseStockMovementHistory,
} from "@store/inventory-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import {
  ProductDetailError,
  ProductDetailNotFound,
  ProductDetailPage,
} from "@/components/products/detail-page";
import { toastManager } from "@/components/ui/toast";
import { toastFailure } from "@/lib/errors";
import { preloadInventory } from "@/lib/inventory/preload";
import { lenientSearchParam } from "@/lib/search-param";

const productSearch = Schema.toStandardSchemaV1(
  Schema.Struct({ addStock: lenientSearchParam(Schema.Boolean) }),
);

export const Route = createFileRoute("/_app/products/$productId")({
  params: { parse: ({ productId }) => ({ productId: decodeProductId(productId) }) },
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
  const [deleteProduct] = useCommand((commands) => commands.deleteProduct);
  const navigate = useNavigate();

  if (!catalogProduct) return <ProductDetailNotFound />;

  const removeProduct = async () => {
    const exit = await deleteProduct(catalogProduct.id);
    if (Exit.isFailure(exit)) {
      toastFailure(exit.cause);
      return;
    }
    toastManager.add({ title: `${catalogProduct.name} deleted`, type: "success" });
    await navigate({ to: "/products" });
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
