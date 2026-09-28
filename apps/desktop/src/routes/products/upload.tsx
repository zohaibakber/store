import { Alert02Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";

import { PageActions } from "@/components/shared/page-actions";
import { PageLayout } from "@/components/shared/page-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { UploadAttachmentList } from "@/components/uploads/attachment-list";
import { UploadProvider, useUpload } from "@/components/uploads/context";
import { UploadDropzone } from "@/components/uploads/dropzone";
import { UploadProposedChanges } from "@/components/uploads/proposed-changes";
import { useSuspenseCatalogCategories } from "@/lib/inventory";

export const Route = createFileRoute("/products/upload")({
  component: UploadInvoicesRoute,
  staticData: { breadcrumb: "Import products" },
});

function UploadInvoicesRoute() {
  const categories = useSuspenseCatalogCategories();
  return (
    <UploadProvider categories={categories}>
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
    <>
      <PageActions>
        <Button
          disabled={processing || !files.length}
          onClick={() => void analyse()}
          size="sm"
          type="button"
        >
          <HugeiconsIcon aria-hidden="true" icon={Upload01Icon} />
          Analyse invoices
        </Button>
      </PageActions>
      <PageLayout width="narrow">
        {!isOnline && (
          <Alert variant="error">
            <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
            <AlertTitle>You're offline</AlertTitle>
            <AlertDescription>
              Invoice uploads need a connection. Your selected files and review stay on this screen.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-2">
          <UploadDropzone />
          <UploadAttachmentList />
        </div>
        <UploadProposedChanges />
      </PageLayout>
    </>
  );
}
