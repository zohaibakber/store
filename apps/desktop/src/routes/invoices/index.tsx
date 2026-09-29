import { createFileRoute } from "@tanstack/react-router";

import { InvoicesPage } from "@/components/invoices/page";
import {
  preloadInventory,
  preloadInvoiceHistory,
  useSuspenseInvoiceHistory,
} from "@/lib/inventory";

export const Route = createFileRoute("/invoices/")({
  loader: ({ context }) => preloadInventory(context, preloadInvoiceHistory),
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
