import { Alert02Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";

import {
  PageAction,
  PageContent,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/shared/page-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { UploadAttachmentList } from "@/components/uploads/attachment-list";
import { UploadProvider, useUpload } from "@/components/uploads/context";
import { UploadDropzone } from "@/components/uploads/dropzone";
import { UploadProposedChanges } from "@/components/uploads/proposed-changes";
import { useCatalogCategories, useCatalogProducts, useInventoryState } from "@/lib/inventory-db";

export const Route = createFileRoute("/products/upload")({
  component: UploadInvoicesRoute,
  staticData: { breadcrumb: "Import products" },
});

function UploadInvoicesRoute() {
  const state = useInventoryState();
  if (!state || state._tag !== "Ready") throw new Error("Inventory storage is not ready.");
  return <LiveUploadInvoices inventory={state.inventory} />;
}

function LiveUploadInvoices({
  inventory,
}: {
  readonly inventory: Extract<
    NonNullable<ReturnType<typeof useInventoryState>>,
    { _tag: "Ready" }
  >["inventory"];
}) {
  const products = useCatalogProducts(inventory);
  const categories = useCatalogCategories(inventory);
  if (categories.isError && categories.data.length === 0) {
    return <p className="p-6 text-sm text-destructive">Could not load inventory.</p>;
  }
  return (
    <UploadProvider products={products.data} categories={categories.data}>
      <UploadPage />
    </UploadProvider>
  );
}

function UploadPage() {
  const {
    state: { files },
    actions: { analyse },
    meta: { processing, isOnline },
  } = useUpload();

  return (
    <PageLayout contentClassName="max-w-3xl">
      <PageHeader>
        <PageHeading>Upload invoices</PageHeading>
        <PageAction>
          <Button disabled={processing || !files.length} onClick={() => void analyse()}>
            <HugeiconsIcon aria-hidden="true" icon={Upload01Icon} />
            Analyse invoices
          </Button>
        </PageAction>
      </PageHeader>

      <PageContent className="mt-2 gap-6">
        {!isOnline && (
          <Alert variant="error">
            <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
            <AlertTitle>You're offline</AlertTitle>
            <AlertDescription>
              Invoice uploads need a connection. Your selected files and review stay on this screen.
            </AlertDescription>
          </Alert>
        )}

        {/* The dropzone doubles as the empty state. A separate one on top of it
            said the same thing twice. */}
        <div className="flex flex-col gap-3">
          <UploadDropzone />
          <UploadAttachmentList />
        </div>

        <UploadProposedChanges />
      </PageContent>
    </PageLayout>
  );
}
