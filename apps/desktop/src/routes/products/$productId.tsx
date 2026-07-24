import { FrameCard } from "@/components/frame-card";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import {
  Alert02Icon,
  ArrowRightFreeIcons,
  PencilEdit02Icon,
  Tag01Icon,
  Trash2,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
import {
  PageAction,
  PageContent,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import { ProductBatchesCard, ProductStockMovementsCard } from "@/components/product-batches";
import { ProductVisibilityCard } from "@/components/product-visibility";
import { formatDate, formatPrice } from "@/lib/format";
import { toast } from "@/lib/toast";

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
      toast.success(`${product.name} deleted`);
      await navigate({ to: "/products" });
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the product.");
    }
  };

  const details: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Aisle", value: product.aisle ?? "—" },
    { label: "Composition", value: product.composition ?? "—" },
    { label: "Strength", value: product.strength ?? "—" },
    { label: "Units per pack", value: product.unitsPerPack },
    { label: "Pack price", value: formatPrice(product.packPrice) },
    { label: "Unit price", value: formatPrice(product.unitPrice) },
    { label: "Created", value: formatDate(product.createdAt) },
    { label: "Updated", value: formatDate(product.updatedAt) },
  ];

  return (
    <PageLayout>
      <PageHeader>
        <div className="flex items-center gap-1">
          <BackToProducts />
          <HugeiconsIcon aria-hidden="true" icon={ArrowRightFreeIcons} className="size-4" />
          <PageHeading>{product.name}</PageHeading>
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
