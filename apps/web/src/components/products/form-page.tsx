import type { Category, ProductSuggestions } from "@store/contracts";
import type * as React from "react";

import { ProductForm, type useProductCreateForm } from "@/components/products/form";
import { FrameCard } from "@/components/shared/frame-card";
import { PageContent, PageLayout } from "@/components/shared/page-layout";
import { Button } from "@/components/ui/button";

export function ProductFormPage({
  cancelTo,
  categories,
  form,
  formId,
  submitLabel,
  suggestions,
  title,
}: {
  cancelTo: React.ReactElement;
  categories: ReadonlyArray<Category>;
  form: ReturnType<typeof useProductCreateForm>;
  formId: string;
  submitLabel: string;
  suggestions: ProductSuggestions;
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
            form={form}
            formId={formId}
            suggestions={suggestions}
          />
        </FrameCard>
      </PageContent>
    </PageLayout>
  );
}
