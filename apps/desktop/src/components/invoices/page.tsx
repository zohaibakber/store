import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";

import { useInvoicesTable, type InvoiceListView } from "@/components/invoices/table";
import { DataTable, DataTableFilter } from "@/components/shared/data-table";
import { ListTableContent } from "@/components/shared/list-view";
import { PageActions } from "@/components/shared/page-actions";
import { PageLayout } from "@/components/shared/page-layout";
import { Button } from "@/components/ui/button";
import {
  useSuspenseInvoiceCount,
  useSuspenseInvoicePage,
  type InvoiceListRequest,
} from "@/lib/inventory";

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
  const table = useInvoicesTable({ rows, total, view, onViewChange, loading });

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
        <ListTableContent loading={loading} />
      </PageLayout>
    </DataTable>
  );
}

export { InvoicesPage };
