import type { Invoice } from "@store/contracts";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
import { Link } from "@tanstack/react-router";
import { Alert02Icon, ArrowRightFreeIcons, Invoice01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import {
  PageContent,
  PageDescription,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import { formatDateTime, formatPrice } from "@/lib/format";
import { Fragment } from "react";

function BackToInvoices() {
  return (
    <Button render={<Link to="/invoices" />} className="-ml-1" variant="ghost" size="sm">
      <HugeiconsIcon aria-hidden="true" icon={Invoice01Icon} />
    </Button>
  );
}

function InvoiceDetailError({ error }: { error: Error }) {
  return (
    <PageLayout contentClassName="max-w-3xl">
      <PageHeader>
        <BackToInvoices />
      </PageHeader>
      <PageContent>
        <Alert variant="destructive">
          <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
          <AlertTitle>Could not load invoice</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </PageContent>
    </PageLayout>
  );
}

function InvoiceDetailPage({ invoice }: { invoice: Invoice }) {
  return (
    <PageLayout contentClassName="max-w-3xl">
      <PageHeader>
        <div className="flex items-center gap-1">
          <BackToInvoices />
          <HugeiconsIcon aria-hidden="true" icon={ArrowRightFreeIcons} className="size-4" />
          <PageHeading>Invoice #{formatInvoiceNumber(invoice.invoiceNumber)}</PageHeading>
        </div>
        <PageDescription>
          {invoice.customerName ?? "Walk-in customer"} · {formatDateTime(invoice.createdAt)}
        </PageDescription>
      </PageHeader>

      <PageContent>
        <Card>
          <CardHeader>
            <CardTitle>Sold items</CardTitle>
          </CardHeader>
          <CardContent>
            <ItemGroup className="gap-0">
              {invoice.items.map((item, index) => (
                <Fragment key={item.id}>
                  {index > 0 && <ItemSeparator />}
                  <Item size="sm" variant={"outline"}>
                    <ItemContent>
                      <ItemTitle>{item.productName}</ItemTitle>
                      <ItemDescription>
                        {item.batchNumber ? `Batch ${item.batchNumber}` : "Unnumbered batch"}
                        {" · "}
                        {item.quantity} {item.quantityType === "pack" ? "packs" : "units"} ×{" "}
                        {formatPrice(item.salePrice)}
                      </ItemDescription>
                    </ItemContent>
                    <span className="font-medium">
                      {formatPrice(item.quantity * item.salePrice)}
                    </span>
                  </Item>
                </Fragment>
              ))}
            </ItemGroup>
          </CardContent>
          <CardFooter className="justify-between border-t">
            <span className="text-muted-foreground">Total</span>
            <span className="font-medium">{formatPrice(invoice.total)}</span>
          </CardFooter>
        </Card>
      </PageContent>
    </PageLayout>
  );
}

export { InvoiceDetailError, InvoiceDetailPage };
