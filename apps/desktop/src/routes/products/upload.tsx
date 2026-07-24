import { Alert02Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";
import { UploadAttachmentList } from "@/components/uploads/upload-attachment-list";
import { UploadDropzone } from "@/components/uploads/upload-dropzone";
import { UploadProposedChanges } from "@/components/uploads/upload-proposed-changes";
import { UploadProvider, useUpload } from "@/components/uploads/upload-context";
import {
  PageAction,
  PageContent,
  PageDescription,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/products/upload")({
  loader: async () => {
    const [products, categories] = await Promise.all([
      window.offlineStore.listProducts(),
      window.offlineStore.listCategories(),
    ]);
    return { products, categories };
  },
  component: UploadInvoicesPage,
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
        <PageDescription>
          Supplier CSVs and PDFs are read by AI into a list of local inventory changes you approve.
        </PageDescription>
        <PageAction>
          <Button disabled={processing || !files.length} onClick={() => void analyse()}>
            <HugeiconsIcon aria-hidden="true" icon={Upload01Icon} />
            Analyse invoices
          </Button>
        </PageAction>
      </PageHeader>

      <PageContent className="gap-6">
        {!isOnline && (
          <Alert variant="error">
            <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
            <AlertTitle>You’re offline</AlertTitle>
            <AlertDescription>
              Invoice uploads need a connection. Your selected files and review stay on this screen.
            </AlertDescription>
          </Alert>
        )}

        {/* The dropzone doubles as the empty state — a separate one on top of it
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
