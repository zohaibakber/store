import { createFileRoute, Link } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Spinner } from "@/components/ui/spinner";
import {
  PageContent,
  PageDescription,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import { ProductsCreateForm, useProductCreateForm } from "@/components/products-create-form";

export const Route = createFileRoute("/products/new")({
  loader: () => window.offlineStore.listCategories(),
  component: NewProductPage,
});

function NewProductPage() {
  const categories = Route.useLoaderData();
  const form = useProductCreateForm(categories);

  return (
    <PageLayout contentClassName="max-w-3xl">
      <PageHeader>
        <PageHeading>Add product</PageHeading>
        <PageDescription>
          Add an item to the local catalog. Prices are entered in Pakistani rupees.
        </PageDescription>
      </PageHeader>

      <PageContent>
        <Card>
          <CardHeader>
            <CardTitle>Product details</CardTitle>
            <CardDescription>
              Name and units per pack are required. Pack and unit prices can be set independently.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProductsCreateForm categories={categories} form={form} />
          </CardContent>
          <CardFooter className="justify-end gap-2 border-t">
            <Link className={buttonVariants({ variant: "outline" })} to="/products">
              Cancel
            </Link>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
              {([canSubmit, isSubmitting]) => (
                <Button disabled={!canSubmit || isSubmitting} form="new-product-form" type="submit">
                  {isSubmitting && <Spinner data-icon="inline-start" />}
                  Create product
                </Button>
              )}
            </form.Subscribe>
          </CardFooter>
        </Card>

        <Alert>
          <AlertTitle>Stored locally first</AlertTitle>
          <AlertDescription>
            The product is available offline immediately and will be included in the next sync.
          </AlertDescription>
        </Alert>
      </PageContent>
    </PageLayout>
  );
}
