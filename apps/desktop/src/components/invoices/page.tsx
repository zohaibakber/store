import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Invoice } from "@store/contracts";
import { Link, useNavigate } from "@tanstack/react-router";

import { DataTable, DataTableFilter } from "@/components/data-table";
import { InvoicesTable, useInvoicesTable } from "@/components/invoices/table";
import {
  PageAction,
  PageContent,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import { Button } from "@/components/ui/button";

function InvoicesPage({ invoices }: { invoices: readonly Invoice[] }) {
  const navigate = useNavigate();
  const table = useInvoicesTable(invoices);

  return (
    <DataTable
      onRowClick={(row) => navigate({ to: "/invoices/$invoiceId", params: { invoiceId: row.id } })}
      table={table}
    >
      <PageLayout contentClassName="gap-4">
        <PageHeader>
          <PageHeading>Invoices</PageHeading>
          <PageAction className="flex items-center gap-2">
            <DataTableFilter columnId="customer" placeholder="Search invoices" />
            <Button render={<Link to="/invoices/new" />}>
              <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
              New sale
            </Button>
          </PageAction>
        </PageHeader>
        <PageContent>
          <InvoicesTable />
        </PageContent>
      </PageLayout>
    </DataTable>
  );
}

export { InvoicesPage };
