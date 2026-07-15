import { Add01Icon, ChevronDownIcon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import {
  PageAction,
  PageContent,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ProductsTable } from "@/components/product-table";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/products/")({
  loader: () => window.offlineStore.listProducts(),
  component: ProductsPage,
});

function ProductsPage() {
  const products = Route.useLoaderData();

  return (
    <PageLayout contentClassName="gap-0">
      <PageHeader>
        <PageHeading>Products</PageHeading>
        <PageAction>
          <ButtonGroup>
            <Button render={<Link to="/products/new" />} variant={"outline"}>
              <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
              Add product
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" className="pl-2!">
                    <HugeiconsIcon icon={ChevronDownIcon} />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className={"w-44"}>
                <DropdownMenuGroup>
                  <DropdownMenuItem render={<Link to="/products/upload" />}>
                    <HugeiconsIcon icon={Upload01Icon} />
                    Upload Invoices
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </ButtonGroup>
        </PageAction>
      </PageHeader>
      <PageContent>
        <ProductsTable products={products} />
      </PageContent>
    </PageLayout>
  );
}
