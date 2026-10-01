import {
  Add01Icon,
  Alert02Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Product, StockMovement } from "@store/contracts";
import { productStock } from "@store/contracts/store-helpers";
import { formatPrice } from "@store/services/format";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import * as React from "react";

import { ProductStockPlan } from "@/components/insights/product-stock-plan";
import {
  AddStockSheet,
  ProductBatchesCard,
  ProductStockMovementsCard,
} from "@/components/products/batches";
import {
  hasOpenPopup,
  isEditableTarget,
  isPlainKey,
  useWindowKeydown,
} from "@/components/products/shortcuts";
import { formatStock } from "@/components/products/stock";
import { ProductVisibilitySelect } from "@/components/products/visibility";
import { FrameCard } from "@/components/shared/frame-card";
import {
  PageAction,
  PageContent,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/shared/page-layout";
import { ShortcutButton } from "@/components/shared/shortcut-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { toastManager } from "@/components/ui/toast";
import { useRememberRecentProduct } from "@/hooks/use-recent-products";
import { toastStoreError } from "@/lib/errors";
import { formValidator } from "@/lib/form-schema";
import { EMPTY, formatDate, formatNumber } from "@/lib/format";
import {
  preloadAll,
  preloadCatalogProduct,
  preloadInventory,
  preloadStockMovementHistory,
  useInventoryActions,
  useSuspenseCatalogProduct,
  useSuspenseStockMovementHistory,
} from "@/lib/inventory";
import { lenientSearchParam } from "@/lib/search-param";

const productSearch = formValidator(
  Schema.Struct({ addStock: lenientSearchParam(Schema.Boolean) }),
);

export const Route = createFileRoute("/products/$productId")({
  loader: ({ context, params }) =>
    preloadInventory(context, (inventory) =>
      preloadAll([
        preloadCatalogProduct(inventory, params.productId),
        preloadStockMovementHistory(inventory, params.productId),
      ]),
    ),
  validateSearch: productSearch,
  component: ProductDetailPage,
  errorComponent: ProductDetailError,
  staticData: { breadcrumb: "Product" },
});

function ProductDetailError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "The product could not be loaded.";
  return (
    <PageLayout width="narrow">
      <Alert variant="error">
        <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
        <AlertTitle>Could not load product</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    </PageLayout>
  );
}

function ProductDetailPage() {
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
    <ProductDetailContent
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

const muted = <span className="text-muted-foreground">{EMPTY}</span>;

const text = (value: string | null) => (value ? value : muted);

const price = (value: number | null) => (value === null ? muted : formatPrice(value));

function DetailsCard({ product }: { readonly product: Product }) {
  const tracksPacks = product.category.tracksPacks;
  const details: ReadonlyArray<{ readonly label: string; readonly value: React.ReactNode }> = [
    { label: "Category", value: product.category.name },
    {
      label: "On hand",
      value: formatStock(productStock(product), product.unitsPerPack, tracksPacks),
    },
    ...(tracksPacks
      ? [
          { label: "Units per pack", value: formatNumber(product.unitsPerPack) },
          { label: "Unit price", value: price(product.unitPrice) },
          { label: "Retail price", value: price(product.retailPrice) },
        ]
      : [{ label: "Retail price", value: price(product.unitPrice) }]),
    { label: "Purchase price", value: price(product.purchasePrice) },
    { label: "Composition", value: text(product.composition) },
    { label: "Strength", value: text(product.strength) },
    { label: "Aisle", value: text(product.aisle) },
    { label: "Created", value: formatDate(product.createdAt) },
    { label: "Updated", value: formatDate(product.updatedAt) },
  ];

  return (
    <FrameCard action={<ProductVisibilitySelect product={product} />} title="Details">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4 xl:grid-cols-6">
        {details.map((detail) => (
          <div className="flex min-w-0 flex-col gap-0.5" key={detail.label}>
            <dt className="truncate text-xs text-muted-foreground">{detail.label}</dt>
            <dd className="truncate tabular-nums">{detail.value}</dd>
          </div>
        ))}
      </dl>
    </FrameCard>
  );
}

function ProductDetailContent({
  addStockOpen,
  movements,
  onAddStockOpenChange,
  onDelete,
  onEdit,
  product,
}: {
  readonly addStockOpen: boolean;
  readonly movements: {
    readonly data: ReadonlyArray<StockMovement>;
    readonly hasNextPage: boolean;
    readonly isFetchingNextPage: boolean;
    readonly fetchNextPage: () => Promise<void>;
  };
  readonly onAddStockOpenChange: (open: boolean) => void;
  readonly onDelete: () => Promise<void>;
  readonly onEdit: () => void;
  readonly product: Product;
}) {
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const hasStock = product.batches.some(
    (batch) => batch.packQuantity > 0 || batch.unitQuantity > 0,
  );
  const summary = [product.category.name, product.strength, product.composition]
    .filter((part): part is string => Boolean(part))
    .join(" · ");

  const { id, name, strength } = product;
  const categoryName = product.category.name;
  const rememberRecentProduct = useRememberRecentProduct();
  React.useEffect(() => {
    rememberRecentProduct({ id, name, strength, category: { name: categoryName } });
  }, [rememberRecentProduct, id, name, strength, categoryName]);

  useWindowKeydown((event) => {
    if (event.defaultPrevented || event.repeat) return;
    if (isEditableTarget(event.target) || hasOpenPopup()) return;
    if (isPlainKey(event, "e")) {
      event.preventDefault();
      onEdit();
    } else if (isPlainKey(event, "a")) {
      event.preventDefault();
      onAddStockOpenChange(true);
    }
  });

  return (
    <PageLayout>
      <PageHeader>
        <div className="flex min-w-0 flex-col gap-1">
          <PageHeading>{product.name}</PageHeading>
          <p className="truncate text-sm text-muted-foreground">{summary}</p>
        </div>
        <PageAction>
          <ShortcutButton
            label="Edit product"
            render={<Link params={{ productId: product.id }} to="/products/$productId/edit" />}
            shortcut="E"
            variant="outline"
          >
            <HugeiconsIcon aria-hidden="true" icon={PencilEdit02Icon} />
            Edit
          </ShortcutButton>
          <ShortcutButton label="Add stock" onClick={() => onAddStockOpenChange(true)} shortcut="A">
            <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
            Add stock
          </ShortcutButton>
          <Menu>
            <MenuTrigger
              render={<Button aria-label="More actions" size="icon-sm" variant="ghost" />}
            >
              <HugeiconsIcon aria-hidden="true" icon={MoreHorizontalIcon} />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => setDeleteOpen(true)} variant="destructive">
                <HugeiconsIcon aria-hidden="true" icon={Delete02Icon} />
                Delete product
              </MenuItem>
            </MenuPopup>
          </Menu>
        </PageAction>
      </PageHeader>

      <AlertDialog onOpenChange={setDeleteOpen} open={deleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              {hasStock
                ? `Sell or adjust remaining stock for ${product.name} before deleting it.`
                : `Delete ${product.name} from the catalog?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
            <AlertDialogClose onClick={onDelete} render={<Button variant="destructive" />}>
              Delete
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddStockSheet onOpenChange={onAddStockOpenChange} open={addStockOpen} product={product} />

      <PageContent>
        <DetailsCard product={product} />
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <ProductBatchesCard product={product} />
            <ProductStockPlan productId={product.id} />
          </div>
          <ProductStockMovementsCard
            hasMore={movements.hasNextPage}
            loadingMore={movements.isFetchingNextPage}
            movements={movements.data}
            onLoadMore={() => void movements.fetchNextPage()}
            product={product}
          />
        </div>
      </PageContent>
    </PageLayout>
  );
}
