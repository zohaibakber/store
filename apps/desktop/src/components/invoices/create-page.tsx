import { InvoiceCheckout, InvoiceCompleteSaleAction } from "@/components/invoices/create-checkout";
import { InvoiceCreateProvider } from "@/components/invoices/create-context";
import { InvoiceItems } from "@/components/invoices/create-items";
import { PageAction, PageContent, PageHeader, PageLayout } from "@/components/shared/page-layout";

function InvoiceCreatePage() {
  return (
    <InvoiceCreateProvider>
      <PageLayout contentClassName="max-w-4xl">
        <PageHeader>
          <PageAction>
            <InvoiceCompleteSaleAction />
          </PageAction>
        </PageHeader>

        <PageContent className="mt-2 gap-6">
          <InvoiceItems />
          <InvoiceCheckout />
        </PageContent>
      </PageLayout>
    </InvoiceCreateProvider>
  );
}

export { InvoiceCreatePage };
