import type { Category, ProductSuggestions } from "@store/contracts";
import type * as React from "react";

import { ProductForm, type useProductCreateForm } from "@/components/products/form";
import {
  PageAction,
  PageDescription,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/shared/page-layout";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { hasOpenModal, hasOpenPopup, useWindowKeydown } from "@/lib/shortcuts";

export function ProductFormPage({
  categories,
  description,
  form,
  formId,
  onCancel,
  submitLabel,
  suggestions,
  title,
}: {
  categories: ReadonlyArray<Category>;
  description?: React.ReactNode;
  form: ReturnType<typeof useProductCreateForm>;
  formId: string;
  onCancel: () => void;
  submitLabel: string;
  suggestions: ProductSuggestions;
  title: React.ReactNode;
}) {
  useWindowKeydown((event) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      if (hasOpenModal()) return;
      event.preventDefault();
      void form.handleSubmit();
      return;
    }
    if (event.key === "Escape" && !hasOpenPopup()) {
      event.preventDefault();
      onCancel();
    }
  }, true);

  return (
    <PageLayout width="narrow">
      <PageHeader>
        <PageHeading>{title}</PageHeading>
        {description ? <PageDescription>{description}</PageDescription> : null}
        <PageAction>
          <Button onClick={onCancel} size="sm" type="button" variant="ghost">
            Cancel
            <Kbd>Esc</Kbd>
          </Button>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button disabled={isSubmitting} form={formId} size="sm" type="submit">
                {submitLabel}
                <Kbd>Ctrl ↵</Kbd>
              </Button>
            )}
          </form.Subscribe>
        </PageAction>
      </PageHeader>
      <ProductForm categories={categories} form={form} formId={formId} suggestions={suggestions} />
    </PageLayout>
  );
}
