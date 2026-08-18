import { Add01Icon, Delete02Icon, PencilEdit02Icon, TagIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Category } from "@store/contracts";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import * as z from "zod";

import { FormField } from "@/components/shared/form-field";
import { FrameCard } from "@/components/shared/frame-card";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Fieldset } from "@/components/ui/fieldset";
import { Frame, FrameHeader } from "@/components/ui/frame";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { toastManager } from "@/components/ui/toast";
import { toastStoreError } from "@/lib/errors";
import { useStore } from "@/lib/store";

const categoryFormSchema = z.object({
  name: z.string().trim().min(1, "Category name is required.").max(64),
  tracksPacks: z.boolean(),
});

type CategoryFormValues = z.infer<typeof categoryFormSchema>;

function PackTrackingField({
  checked,
  id,
  onChange,
}: {
  checked: boolean;
  id: string;
  onChange: (tracksPacks: boolean) => void;
}) {
  return (
    <Field className="flex-row items-start gap-4">
      <div className="min-w-0 flex-1">
        <FieldLabel htmlFor={id}>Sold in packs</FieldLabel>
        <FieldDescription>
          Off for things sold one at a time: the product form drops pack size and pack price, and
          stock arrives as a quantity with an expiry rather than a numbered batch.
        </FieldDescription>
      </div>
      <Switch checked={checked} id={id} onCheckedChange={onChange} />
    </Field>
  );
}

function CategorySheet({
  category,
  onSaved,
  trigger,
}: {
  category?: Category;
  onSaved: () => Promise<void>;
  trigger: React.ReactElement;
}) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const formId = `category-form-${category?.id ?? "new"}`;
  const defaults: CategoryFormValues = {
    name: category?.name ?? "",
    tracksPacks: category?.tracksPacks ?? true,
  };

  const form = useForm({
    defaultValues: defaults,
    validators: { onSubmit: categoryFormSchema },
    onSubmit: async ({ value }) => {
      try {
        if (category) await store.updateCategory({ id: category.id, ...value });
        else await store.createCategory(value);
        toastManager.add({
          title: category ? "Category updated" : "Category added",
          type: "success",
        });
        setOpen(false);
        await onSaved();
      } catch (error) {
        toastStoreError(error, "Could not save the category.");
      }
    },
  });

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) form.reset(defaults);
        setOpen(next);
      }}
    >
      <SheetTrigger render={trigger} />
      <SheetPopup variant="inset">
        <SheetHeader>
          <SheetTitle>{category ? "Edit category" : "Add category"}</SheetTitle>
          <SheetDescription>
            A category decides which fields a product in it needs.
          </SheetDescription>
        </SheetHeader>
        <SheetPanel>
          <form
            id={formId}
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <Fieldset className="grid w-full gap-6">
              <form.Field
                name="name"
                children={(field) => (
                  <FormField field={field} label="Name">
                    {(control) => (
                      <Input
                        {...control}
                        autoFocus
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        placeholder="e.g. Medicine"
                        value={field.state.value}
                      />
                    )}
                  </FormField>
                )}
              />
              <form.Field
                name="tracksPacks"
                children={(field) => (
                  <PackTrackingField
                    checked={field.state.value}
                    id={field.name}
                    onChange={(tracksPacks) => field.handleChange(tracksPacks)}
                  />
                )}
              />
            </Fieldset>
          </form>
        </SheetPanel>
        <SheetFooter>
          <SheetClose render={<Button variant="ghost" />}>Cancel</SheetClose>
          <form.Subscribe selector={(state) => state.canSubmit}>
            {(canSubmit) => (
              <Button disabled={!canSubmit} form={formId} type="submit">
                {category ? "Save changes" : "Add category"}
              </Button>
            )}
          </form.Subscribe>
        </SheetFooter>
      </SheetPopup>
    </Sheet>
  );
}

function DeleteCategoryDialog({
  category,
  onDeleted,
}: {
  category: Category;
  onDeleted: () => Promise<void>;
}) {
  const store = useStore();

  const remove = async () => {
    try {
      await store.deleteCategory({ id: category.id });
      toastManager.add({ title: `${category.name} deleted`, type: "success" });
      await onDeleted();
    } catch (error) {
      toastStoreError(error, "Could not delete the category.");
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button aria-label={`Delete ${category.name}`} size="icon-sm" variant="ghost" />}
      >
        <HugeiconsIcon aria-hidden="true" icon={Delete02Icon} />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {category.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Products still in this category keep it, so move them first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
          <AlertDialogClose render={<Button variant="destructive" />} onClick={() => void remove()}>
            Delete
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function CategorySettings({ categories }: { categories: ReadonlyArray<Category> }) {
  const router = useRouter();
  const refresh = () => router.invalidate();

  return (
    <FrameCard
      action={
        <CategorySheet
          onSaved={refresh}
          trigger={
            <Button size="sm" variant="outline">
              <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
              Add category
            </Button>
          }
        />
      }
      description="A category decides which fields its products need."
      title="Categories"
    >
      {categories.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon aria-hidden="true" icon={TagIcon} />
            </EmptyMedia>
            <EmptyTitle>No categories yet</EmptyTitle>
            <EmptyDescription>
              Add the ones this shop uses — products are filed under them.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {categories.map((category) => (
            <Frame className="w-full" key={category.id}>
              <FrameHeader className="flex-row items-center gap-3 px-4 py-3">
                <p className="min-w-0 flex-1 truncate font-medium">{category.name}</p>
                <Badge variant={category.tracksPacks ? "secondary" : "outline"}>
                  {category.tracksPacks ? "Packs" : "Single units"}
                </Badge>
                <CategorySheet
                  category={category}
                  onSaved={refresh}
                  trigger={
                    <Button aria-label={`Edit ${category.name}`} size="icon-sm" variant="ghost">
                      <HugeiconsIcon aria-hidden="true" icon={PencilEdit02Icon} />
                    </Button>
                  }
                />
                <DeleteCategoryDialog category={category} onDeleted={refresh} />
              </FrameHeader>
            </Frame>
          ))}
        </div>
      )}
    </FrameCard>
  );
}
