import { createFileRoute, Link } from "@tanstack/react-router";
import { Alert02Icon, ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatPrice } from "@/lib/format";

export const Route = createFileRoute("/products/$productId")({
  loader: ({ params }) => window.offlineStore.getProduct({ id: params.productId }),
  component: ProductDetailPage,
  errorComponent: ProductDetailError,
});

function ProductDetailError({ error }: { error: Error }) {
  return (
    <main className="p-6 md:p-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <BackToProducts />
        <Alert variant="destructive">
          <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
          <AlertTitle>Could not load product</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </div>
    </main>
  );
}

function BackToProducts() {
  return (
    <Link className={buttonVariants({ size: "sm", variant: "ghost" })} to="/products">
      <HugeiconsIcon aria-hidden="true" icon={ArrowLeft01Icon} />
      Products
    </Link>
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
    <main className="p-6 md:p-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <BackToProducts />
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-medium tracking-tight">{product.name}</h1>
          <Badge className="capitalize" variant="outline">
            {product.category.name}
          </Badge>
        </div>

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
      </div>
    </main>
  );
}
