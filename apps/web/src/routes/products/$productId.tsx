import {
  Alert02Icon,
  ArrowRightFreeIcons,
  PencilEdit02Icon,
  Tag01Icon,
  Trash2,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Product, StockMovement } from "@store/contracts";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { ProductBatchesCard, ProductStockMovementsCard } from "@/components/products/batches";
import { ProductVisibilityCard } from "@/components/products/visibility";
import { FrameCard } from "@/components/shared/frame-card";
import {
  PageAction,
  PageContent,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/shared/page-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";
import { toastStoreError } from "@/lib/errors";
import { formatDate, formatPrice } from "@/lib/format";
import {
  useCatalogProduct,
  useCatalogStockMovements,
  useInventoryActions,
} from "@/lib/inventory-db";

export const Route = createFileRoute("/products/$productId")({
  component: ProductDetailPage,
  errorComponent: ProductDetailError,
  staticData: { breadcrumb: "Product" },
});

function ProductDetailError({ error }: { error: Error }) {
  return (
    <PageLayout contentClassName="max-w-3xl">
      <PageHeader>
        <BackToProducts />
      </PageHeader>
      <PageContent>
        <Alert variant="error">
          <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
          <AlertTitle>Could not load product</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </PageContent>
    </PageLayout>
  );
}

function BackToProducts() {
  return (
    <Button render={<Link to="/products" />} className={"-ml-1"} variant={"ghost"} size={"sm"}>
      <HugeiconsIcon aria-hidden="true" icon={Tag01Icon} />
    </Button>
  );
}

function ProductDetailPage() {
  const { productId } = Route.useParams();
  const product = useCatalogProduct(productId);
  const movements = useCatalogStockMovements(productId);
  const { deleteProduct } = useInventoryActions();
  const navigate = useNavigate();

  const catalogProduct = product.data;
  if (!catalogProduct) {
    if (product.isError || movements.isError) {
      return <ProductDetailError error={new Error("The product data could not be loaded.")} />;
    }
    if (product.isReady) {
      return <ProductDetailError error={new Error(`Product ${productId} was not found.`)} />;
    }
    return null;
  }

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
      movements={movements.data}
      onDelete={removeProduct}
      product={catalogProduct}
    />
  );
}

function ProductDetailContent({
  movements,
  onDelete,
  product,
}: {
  readonly movements: ReadonlyArray<StockMovement>;
  readonly onDelete: () => Promise<void>;
  readonly product: Product;
}) {
  // Pack size and pack retail are meaningless for a category sold one at a time.
  const packDetails: Array<{ label: string; value: React.ReactNode }> = product.category.tracksPacks
    ? [
        {
          label: "Units per pack",
          value: <span className="font-mono tabular-nums">{product.unitsPerPack}</span>,
        },
        {
          label: "Retail price",
          value: <span className="font-mono tabular-nums">{formatPrice(product.retailPrice)}</span>,
        },
      ]
    : [];

  const details: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Aisle", value: product.aisle ?? "—" },
    { label: "Composition", value: product.composition ?? "—" },
    { label: "Strength", value: product.strength ?? "—" },
    {
      label: "Purchase price",
      value: <span className="font-mono tabular-nums">{formatPrice(product.purchasePrice)}</span>,
    },
    ...packDetails,
    {
      label: product.category.tracksPacks ? "Unit price" : "Retail price",
      value: <span className="font-mono tabular-nums">{formatPrice(product.unitPrice)}</span>,
    },
    {
      label: "Created",
      value: <span className="font-mono tabular-nums">{formatDate(product.createdAt)}</span>,
    },
    {
      label: "Updated",
      value: <span className="font-mono tabular-nums">{formatDate(product.updatedAt)}</span>,
    },
  ];

  return (
    <PageLayout>
      <PageHeader>
        <div className="flex items-center">
          <BackToProducts />
          <HugeiconsIcon aria-hidden="true" icon={ArrowRightFreeIcons} className="size-4" />
          <PageHeading className="ml-2 capitalize">{product.name}</PageHeading>
        </div>
        <PageAction>
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button aria-label="Delete product" variant="ghost" size="icon" />}
            >
              <HugeiconsIcon icon={Trash2} />
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete product?</AlertDialogTitle>
                <AlertDialogDescription>
                  {product.batches.some((batch) => batch.packQuantity > 0 || batch.unitQuantity > 0)
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
        </PageAction>
      </PageHeader>

      <PageContent className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          <FrameCard
            action={
              <Button
                render={<Link params={{ productId: product.id }} to="/products/$productId/edit" />}
                size="sm"
                variant="outline"
              >
                <HugeiconsIcon aria-hidden="true" icon={PencilEdit02Icon} />
                Edit
              </Button>
            }
            title="Details"
          >
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
              {details.map((detail) => (
                <div className="flex items-baseline justify-between gap-4" key={detail.label}>
                  <dt className="text-muted-foreground">{detail.label}</dt>
                  <dd className="text-right">{detail.value}</dd>
                </div>
              ))}
            </dl>
          </FrameCard>

          <ProductBatchesCard product={product} />
        </div>

        <div className="flex flex-col gap-4">
          <ProductVisibilityCard product={product} />
          <ProductStockMovementsCard product={product} movements={movements} />
        </div>
      </PageContent>
    </PageLayout>
  );
}
