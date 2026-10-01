import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";

import { InvoicesTable, useInvoicesTable, type InvoiceListView } from "@/components/invoices/table";
import { DataTable, DataTableFilter } from "@/components/shared/data-table";
import { PageActions } from "@/components/shared/page-actions";
import { PageLayout } from "@/components/shared/page-layout";
import { Button } from "@/components/ui/button";
import {
  useSuspenseInvoiceCount,
  useSuspenseInvoicePage,
  type InvoiceListRequest,
} from "@/lib/inventory";
import { cn } from "@/lib/utils";

function InvoicesPage({
  loading,
  onViewChange,
  request,
  view,
}: {
  readonly loading: boolean;
  readonly onViewChange: (view: InvoiceListView) => void;
  readonly request: InvoiceListRequest;
  readonly view: InvoiceListView;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const rows = useSuspenseInvoicePage(request);
  const total = useSuspenseInvoiceCount(request.filters);
  const table = useInvoicesTable({ rows, total, view, onViewChange });

  return (
    <DataTable
      onRowClick={(row) => navigate({ to: "/invoices/$invoiceId", params: { invoiceId: row.id } })}
      onRowPreload={(row) =>
        void router.preloadRoute({ to: "/invoices/$invoiceId", params: { invoiceId: row.id } })
      }
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
        <div aria-busy={loading} className={cn("transition-opacity", loading && "opacity-60")}>
          <InvoicesTable />
        </div>
      </PageLayout>
    </DataTable>
  );
}

export { InvoicesPage };
