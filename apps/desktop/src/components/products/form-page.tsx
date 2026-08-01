import type { Category } from "@store/contracts";
import type * as React from "react";

import { ProductForm, type useProductCreateForm } from "@/components/products/form";
import { FrameCard } from "@/components/shared/frame-card";
import { PageContent, PageLayout } from "@/components/shared/page-layout";
import { Button } from "@/components/ui/button";

/**
 * The shell shared by the create and edit product routes. Only the heading,
 * the submit label and where "Cancel" goes differ, so those are the props;
 * `cancelTo` is a rendered `<Link/>` the button adopts.
 */
export function ProductFormPage({
  cancelTo,
  categories,
  compositions,
  form,
  formId,
  submitLabel,
  title,
}: {
  cancelTo: React.ReactElement;
  categories: ReadonlyArray<Category>;
  compositions: ReadonlyArray<string>;
  form: ReturnType<typeof useProductCreateForm>;
  formId: string;
  submitLabel: string;
  title: React.ReactNode;
}) {
  return (
    <PageLayout contentClassName="max-w-3xl">
      <PageContent>
        <FrameCard
          action={
            <div className="flex items-center gap-2">
              <Button render={cancelTo} size="sm" variant="outline">
                Cancel
              </Button>
              <form.Subscribe selector={(state) => state.canSubmit}>
                {(canSubmit) => (
                  <Button disabled={!canSubmit} form={formId} size="sm" type="submit">
                    {submitLabel}
                  </Button>
                )}
              </form.Subscribe>
            </div>
          }
          title={<h1 className="font-medium">{title}</h1>}
        >
          <ProductForm
            categories={categories}
            compositions={compositions}
            form={form}
            formId={formId}
          />
        </FrameCard>
      </PageContent>
    </PageLayout>
  );
}
