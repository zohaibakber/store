import type { Product } from "@store/contracts";

import { Card } from "@/components/ui/card";
import { InvoiceCheckout } from "@/components/invoices/invoice-create-checkout";
import { InvoiceCreateProvider } from "@/components/invoices/invoice-create-context";
import { InvoiceItems } from "@/components/invoices/invoice-create-items";
import {
  PageContent,
  PageDescription,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";

function InvoiceCreatePage({ products }: { products: readonly Product[] }) {
  return (
    <InvoiceCreateProvider products={products}>
      <PageLayout contentClassName="max-w-4xl">
        <PageHeader>
          <PageHeading>New sale</PageHeading>
          <PageDescription>
            Search the catalog to add items. Stock is drawn from the earliest-expiring batch unless
            one is picked.
          </PageDescription>
        </PageHeader>

        <PageContent>
          <Card>
            <InvoiceItems />
            <InvoiceCheckout />
          </Card>
        </PageContent>
      </PageLayout>
    </InvoiceCreateProvider>
  );
}

export { InvoiceCreatePage };
