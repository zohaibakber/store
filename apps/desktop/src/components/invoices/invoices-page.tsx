import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Invoice } from "@store/contracts";
import { Button } from "@/components/ui/button";
import {
  PageAction,
  PageContent,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import { Link } from "@tanstack/react-router";
import { InvoicesTable } from "@/components/invoice-table";

function InvoicesPage({ invoices }: { invoices: readonly Invoice[] }) {
  return (
    <PageLayout contentClassName="gap-0">
      <PageHeader>
        <PageHeading>Invoices</PageHeading>
        <PageAction>
          <Button render={<Link to="/invoices/new" />}>
            <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
            New sale
          </Button>
        </PageAction>
      </PageHeader>
      <PageContent>
        <InvoicesTable invoices={invoices} />
      </PageContent>
    </PageLayout>
  );
}

export { InvoicesPage };
