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

export const Route = createFileRoute("/products/upload")({
  loader: async ({ context }) => {
    const [products, categories] = await Promise.all([
      context.store.listProducts(),
      context.store.listCategories(),
    ]);
    return { products, categories };
  },
  component: UploadInvoicesPage,
  staticData: { breadcrumb: "Import products" },
});

function UploadInvoicesPage() {
  const { products, categories } = Route.useLoaderData();
  return (
    <UploadProvider products={products} categories={categories}>
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
