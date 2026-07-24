import type { Product } from "@store/contracts";

import { InvoiceCheckout, InvoiceCompleteSaleAction } from "@/components/invoices/create-checkout";
import { InvoiceCreateProvider } from "@/components/invoices/create-context";
import { InvoiceItems } from "@/components/invoices/create-items";
import {
  PageAction,
  PageContent,
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
          <PageAction>
            <InvoiceCompleteSaleAction />
          </PageAction>
        </PageHeader>

        <PageContent className="gap-6">
          <InvoiceItems />
          <InvoiceCheckout />
        </PageContent>
      </PageLayout>
    </InvoiceCreateProvider>
  );
}

export { InvoiceCreatePage };
