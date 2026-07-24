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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

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
    state: { files, changes },
    actions: { analyse },
    meta: { processing, isOnline },
  } = useUpload();

  return (
    <PageLayout>
      <PageHeader>
        <PageHeading>Upload invoices</PageHeading>
        <PageDescription>
          Upload supplier CSVs and PDFs. AI extracts stock, then you approve every local inventory
          change.
        </PageDescription>
        <PageAction>
          <Button disabled={processing || !files.length} onClick={() => void analyse()}>
            <HugeiconsIcon data-icon="inline-start" icon={Upload01Icon} />
            Analyse invoices
          </Button>
        </PageAction>
      </PageHeader>
      <PageContent>
        {!isOnline && (
          <Alert variant="error">
            <HugeiconsIcon icon={Alert02Icon} />
            <AlertTitle>You’re offline</AlertTitle>
            <AlertDescription>
              Invoice uploads need a connection. Your selected files and review stay on this screen.
            </AlertDescription>
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Attachments</CardTitle>
            <CardDescription>
              Choose one or more supplier invoices in PDF or CSV format.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <UploadDropzone />
            <UploadAttachmentList />
          </CardContent>
        </Card>
        <UploadProposedChanges />
        {!files.length && !changes.length && (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={Upload01Icon} />
              </EmptyMedia>
              <EmptyTitle>No invoices selected</EmptyTitle>
              <EmptyDescription>
                Upload supplier files to turn received stock into a reviewable list of local
                changes.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </PageContent>
    </PageLayout>
  );
}
