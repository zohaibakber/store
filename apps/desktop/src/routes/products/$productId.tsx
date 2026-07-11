import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Alert02Icon,
  ArrowRightFreeIcons,
  ChevronDown,
  ChevronUp,
  Tag01Icon,
  Trash2,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PageAction,
  PageContent,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import { formatDate, formatPrice } from "@/lib/format";

export const Route = createFileRoute("/products/$productId")({
  loader: ({ params }) => window.offlineStore.getProduct({ id: params.productId }),
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
        <Alert variant="destructive">
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
  const product = Route.useLoaderData();

  const details: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Barcode", value: product.barcode ?? "—" },
    { label: "Composition", value: product.composition ?? "—" },
    { label: "Strength", value: product.strength ?? "—" },
    { label: "Units per pack", value: product.unitsPerPack },
    { label: "Cost price", value: formatPrice(product.costPrice) },
    { label: "Pack price", value: formatPrice(product.packPrice) },
    { label: "Unit price", value: formatPrice(product.unitPrice) },
    { label: "Created", value: formatDate(product.createdAt) },
    { label: "Updated", value: formatDate(product.updatedAt) },
  ];

  return (
    <PageLayout contentClassName="max-w-3xl">
      <PageHeader>
        <div className="flex items-center gap-1">
          <BackToProducts />
          <HugeiconsIcon aria-hidden="true" icon={ArrowRightFreeIcons} className="size-4" />
          <PageHeading>{product.name}</PageHeading>
        </div>
        <PageAction>
          <Button variant="ghost" size="icon">
            <HugeiconsIcon icon={ChevronUp} />
          </Button>
          <Button variant="ghost" size="icon">
            <HugeiconsIcon icon={ChevronDown} />
          </Button>
          <Button variant="ghost" size="icon">
            <HugeiconsIcon icon={Trash2} />
          </Button>
        </PageAction>
      </PageHeader>

      <PageContent>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
              {details.map((detail) => (
                <div className="flex items-baseline justify-between gap-4" key={detail.label}>
                  <dt className="text-muted-foreground">{detail.label}</dt>
                  <dd className="text-right">{detail.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </PageContent>
    </PageLayout>
  );
}
