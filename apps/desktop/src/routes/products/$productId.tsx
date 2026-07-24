import {
  Alert02Icon,
  ArrowRightFreeIcons,
  PencilEdit02Icon,
  Tag01Icon,
  Trash2,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";

import { FrameCard } from "@/components/frame-card";
import {
  PageAction,
  PageContent,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import { ProductBatchesCard, ProductStockMovementsCard } from "@/components/products/batches";
import { ProductVisibilityCard } from "@/components/products/visibility";
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
import { formatDate, formatPrice } from "@/lib/format";

export const Route = createFileRoute("/products/$productId")({
  loader: async ({ params }) => {
    const input = { id: params.productId };
    const [product, movements] = await Promise.all([
      window.offlineStore.getProduct(input),
      window.offlineStore.listStockMovements(input),
    ]);
    return { product, movements };
  },
  component: ProductDetailPage,
  errorComponent: ProductDetailError,
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
  const { product, movements } = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();

  const deleteProduct = async () => {
    try {
      await window.offlineStore.deleteProduct({ id: product.id });
      toastManager.add({ title: `${product.name} deleted`, type: "success" });
      await navigate({ to: "/products" });
      await router.invalidate();
    } catch (error) {
      toastManager.add({
        title: error instanceof Error ? error.message : "Could not delete the product.",
        type: "error",
      });
    }
  };

  const details: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Aisle", value: product.aisle ?? "—" },
    { label: "Composition", value: product.composition ?? "—" },
    { label: "Strength", value: product.strength ?? "—" },
    {
      label: "Units per pack",
      value: <span className="font-mono tabular-nums">{product.unitsPerPack}</span>,
    },
    {
      label: "Pack price",
      value: <span className="font-mono tabular-nums">{formatPrice(product.packPrice)}</span>,
    },
    {
      label: "Unit price",
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
          <PageHeading className="ml-2">{product.name}</PageHeading>
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
                  Delete {product.name}? Stock and batches for this product will no longer appear.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
                <AlertDialogClose onClick={deleteProduct} render={<Button variant="destructive" />}>
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
