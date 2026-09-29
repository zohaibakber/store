import { createFileRoute } from "@tanstack/react-router";

import { InvoicesPage } from "@/components/invoices/page";
import { useSuspenseInvoiceHistory } from "@/lib/inventory";

export const Route = createFileRoute("/invoices/")({
  component: InvoicesRoute,
});

function InvoicesRoute() {
  const history = useSuspenseInvoiceHistory();
  return (
    <InvoicesPage
      hasMore={history.hasNextPage}
      invoices={history.data}
      loadingMore={history.isFetchingNextPage}
      onLoadMore={() => void history.fetchNextPage()}
    />
  );
}
