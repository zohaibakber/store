import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Invoice } from "@store/contracts";
import { Link, useNavigate } from "@tanstack/react-router";

import { InvoicesTable, useInvoicesTable } from "@/components/invoices/table";
import { DataTable, DataTableFilter } from "@/components/shared/data-table";
import { PageActions } from "@/components/shared/page-actions";
import { PageLayout } from "@/components/shared/page-layout";
import { Button } from "@/components/ui/button";

function InvoicesPage({ invoices }: { invoices: readonly Invoice[] }) {
  const navigate = useNavigate();
  const table = useInvoicesTable(invoices);

  return (
    <DataTable
      onRowClick={(row) => navigate({ to: "/invoices/$invoiceId", params: { invoiceId: row.id } })}
      table={table}
    >
      <PageActions>
        <DataTableFilter columnId="customer" placeholder="Search invoices" />
        <Button render={<Link to="/invoices/new" />} size="sm">
          <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
          New sale
        </Button>
      </PageActions>
      <PageLayout>
        <InvoicesTable />
      </PageLayout>
    </DataTable>
  );
}

export { InvoicesPage };
