import { useState } from "react";
import { formOptions, useForm } from "@tanstack/react-form";
import { useNavigate, useRouter } from "@tanstack/react-router";
import type { Category, Product } from "@store/contracts";
import { PencilEdit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "@/lib/toast";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormFieldError } from "@/components/form-field-error";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Fieldset } from "@/components/ui/fieldset";
import { Input } from "@/components/ui/input";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "@/components/ui/number-field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const strengthUnits = ["mg", "mcg", "g", "ml", "l"] as const;
const strengthUnitItems = strengthUnits.map((unit) => ({ label: unit, value: unit }));

const optionalPrice = z
  .string()
  .refine((value) => value === "" || (Number.isFinite(Number(value)) && Number(value) >= 0), {
    message: "Enter a valid price or leave this blank.",
  });

const productFormSchema = z.object({
  name: z.string().trim().min(1, "Product name is required.").max(120),
  categoryId: z.string().min(1, "Category is required."),
  aisle: z.string().trim().max(64),
  composition: z.string().trim().max(160),
  strength: z.string().trim().max(20),
  strengthUnit: z.enum(strengthUnits),
  unitsPerPack: z
    .string()
    .refine((value) => Number.isInteger(Number(value)) && Number(value) >= 1, {
      message: "Units per pack must be a whole number of 1 or more.",
    }),
  packPrice: optionalPrice,
  unitPrice: optionalPrice,
});

const nullableText = (value: string) => value.trim() || null;
const priceInPaisa = (value: string) => (value === "" ? null : Math.round(Number(value) * 100));
const priceFromPaisa = (value: number | null) => (value == null ? "" : String(value / 100));
const numberFieldValue = (value: string) => (value === "" ? null : Number(value));

const computeUnitPrice = (unitsPerPack: string, packPrice: string) => {
  const units = Number(unitsPerPack);
  const pack = Number(packPrice);
  if (packPrice === "" || !Number.isFinite(units) || units < 1 || !Number.isFinite(pack)) {
    return null;
  }
  return String(Math.round(pack / units));
};

const parseStrength = (value: string | null) => {
  const match = value?.match(/^([\d.]+)\s*(mg|mcg|g|ml|l)$/i);
  if (!match)
    return { strength: value ?? "", strengthUnit: "mg" as (typeof strengthUnits)[number] };
  return {
    strength: match[1],
    strengthUnit: match[2].toLowerCase() as (typeof strengthUnits)[number],
  };
};

// Shared shape and validation for both the create and edit flows — each hook
// below spreads this in and only differs in defaultValues and onSubmit.
const productFormOpts = formOptions({
  defaultValues: {
    name: "",
    categoryId: "",
    aisle: "",
    composition: "",
    strength: "",
    strengthUnit: "mg" as (typeof strengthUnits)[number],
    unitsPerPack: "",
    packPrice: "",
    unitPrice: "",
  },
  validators: { onSubmit: productFormSchema },
});

const defaultCategoryId = (categories: ReadonlyArray<Category>) =>
  categories.find((category) => category.id === "general")?.id ?? categories[0]?.id ?? "";

const productToFormValues = (product: Product) => {
  const { strength, strengthUnit } = parseStrength(product.strength);
  return {
    name: product.name,
    categoryId: product.categoryId,
    aisle: product.aisle ?? "",
    composition: product.composition ?? "",
    strength,
    strengthUnit,
    unitsPerPack: String(product.unitsPerPack),
    packPrice: priceFromPaisa(product.packPrice),
    unitPrice: priceFromPaisa(product.unitPrice),
  };
};

function useProductCreateForm(categories: ReadonlyArray<Category>) {
  const navigate = useNavigate();

  return useForm({
    ...productFormOpts,
    defaultValues: { ...productFormOpts.defaultValues, categoryId: defaultCategoryId(categories) },
    onSubmit: async ({ value }) => {
      try {
        const strengthValue = value.strength.trim();
        const product = await window.offlineStore.createProduct({
          name: value.name.trim(),
          categoryId: value.categoryId,
          aisle: nullableText(value.aisle),
          composition: nullableText(value.composition),
          strength: strengthValue ? `${strengthValue}${value.strengthUnit}` : null,
          unitsPerPack: Number(value.unitsPerPack),
          packPrice: priceInPaisa(value.packPrice),
          unitPrice: priceInPaisa(value.unitPrice),
        });
        toast.success("Product created");
        await navigate({ to: "/products/$productId", params: { productId: product.id } });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not create the product.");
      }
    },
  });
}

function useProductUpdateForm(product: Product, onUpdated: () => void) {
  return useForm({
    ...productFormOpts,
    defaultValues: productToFormValues(product),
    onSubmit: async ({ value }) => {
      try {
        const strengthValue = value.strength.trim();
        await window.offlineStore.updateProduct({
          id: product.id,
          name: value.name.trim(),
          categoryId: value.categoryId,
          aisle: nullableText(value.aisle),
          composition: nullableText(value.composition),
          strength: strengthValue ? `${strengthValue}${value.strengthUnit}` : null,
          unitsPerPack: Number(value.unitsPerPack),
          packPrice: priceInPaisa(value.packPrice),
          unitPrice: priceInPaisa(value.unitPrice),
        });
        toast.success("Product updated");
        onUpdated();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not update the product.");
      }
    },
  });
}

function ProductForm({
  categories,
  form,
  formId,
}: {
  categories: ReadonlyArray<Category>;
  form: ReturnType<typeof useProductCreateForm>;
  formId: string;
}) {
  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <Fieldset className="flex w-full flex-col gap-6">
        <form.Field
          name="name"
          children={(field) => {
            const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={invalid}>
                <FieldLabel htmlFor={field.name}>Product name</FieldLabel>
                <Input
                  aria-invalid={invalid}
                  autoFocus
                  id={field.name}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="e.g. Panadol 500mg"
                  value={field.state.value}
                />
                {invalid && <FormFieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        />

        <Fieldset className="grid gap-4 sm:grid-cols-2">
          <form.Field
            name="categoryId"
            children={(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={field.name}>Category</FieldLabel>
                  <Select
                    items={categories.map((category) => ({
                      label: category.name,
                      value: category.id,
                    }))}
                    name={field.name}
                    onValueChange={(value) => value && field.handleChange(value)}
                    value={field.state.value}
                  >
                    <SelectTrigger aria-invalid={invalid} className="w-full" id={field.name}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {categories.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {invalid && <FormFieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          />
          <form.Field
            name="aisle"
            children={(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={field.name}>Aisle</FieldLabel>
                  <Input
                    aria-invalid={invalid}
                    id={field.name}
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="e.g. A3"
                    value={field.state.value}
                  />
                  {invalid && <FormFieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          />
        </Fieldset>

        <Fieldset className="grid gap-4 sm:grid-cols-2">
          <form.Field
            name="composition"
            children={(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={field.name}>Composition</FieldLabel>
                  <Input
                    aria-invalid={invalid}
                    id={field.name}
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="e.g. Paracetamol"
                    value={field.state.value}
                  />
                  {invalid && <FormFieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          />
          <form.Field
            name="strength"
            children={(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={field.name}>Strength</FieldLabel>
                  <ButtonGroup aria-label="Strength" className="w-full">
                    <NumberField
                      className="flex-1"
                      format={{ maximumFractionDigits: 2 }}
                      id={field.name}
                      min={0}
                      onValueChange={(value) =>
                        field.handleChange(value === null ? "" : String(value))
                      }
                      value={numberFieldValue(field.state.value)}
                    >
                      <NumberFieldGroup>
                        <NumberFieldInput
                          aria-invalid={invalid}
                          aria-label="Strength value"
                          className="text-left"
                          name={field.name}
                          onBlur={field.handleBlur}
                          placeholder="e.g. 500"
                        />
                      </NumberFieldGroup>
                    </NumberField>
                    <form.Field
                      name="strengthUnit"
                      children={(unitField) => (
                        <Select
                          items={strengthUnitItems}
                          name={unitField.name}
                          onValueChange={(value) => value && unitField.handleChange(value)}
                          value={unitField.state.value}
                        >
                          <SelectTrigger aria-label="Strength unit">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent alignItemWithTrigger={false}>
                            <SelectGroup>
                              {strengthUnitItems.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </ButtonGroup>
                  {invalid && <FormFieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          />
        </Fieldset>

        <Fieldset className="grid gap-4 sm:grid-cols-2">
          <div className="grid grid-cols-2 gap-4">
            <form.Field
              listeners={{
                onChange: ({ value, fieldApi }) => {
                  const packPrice = fieldApi.form.getFieldValue("packPrice");
                  const unitPrice = computeUnitPrice(value, packPrice);
                  if (unitPrice !== null) {
                    fieldApi.form.setFieldValue("unitPrice", unitPrice);
                  }
                },
              }}
              name="unitsPerPack"
              children={(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={field.name}>Units per pack</FieldLabel>
                    <NumberField
                      format={{ maximumFractionDigits: 0 }}
                      id={field.name}
                      min={1}
                      onValueChange={(value) =>
                        field.handleChange(value === null ? "" : String(value))
                      }
                      step={1}
                      value={numberFieldValue(field.state.value)}
                    >
                      <NumberFieldGroup>
                        <NumberFieldInput
                          aria-invalid={invalid}
                          className="text-left"
                          name={field.name}
                          onBlur={field.handleBlur}
                          placeholder="1"
                        />
                      </NumberFieldGroup>
                    </NumberField>
                    <FieldDescription>Use 1 when the item is sold as-is.</FieldDescription>
                    {invalid && <FormFieldError errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            />
            <form.Field
              listeners={{
                onChange: ({ value, fieldApi }) => {
                  const unitsPerPack = fieldApi.form.getFieldValue("unitsPerPack");
                  const unitPrice = computeUnitPrice(unitsPerPack, value);
                  if (unitPrice !== null) {
                    fieldApi.form.setFieldValue("unitPrice", unitPrice);
                  }
                },
              }}
              name="packPrice"
              children={(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={field.name}>Pack price</FieldLabel>
                    <NumberField
                      format={{ maximumFractionDigits: 2 }}
                      id={field.name}
                      min={0}
                      onValueChange={(value) =>
                        field.handleChange(value === null ? "" : String(value))
                      }
                      step={0.01}
                      value={numberFieldValue(field.state.value)}
                    >
                      <NumberFieldGroup>
                        <NumberFieldInput
                          aria-invalid={invalid}
                          className="text-left"
                          name={field.name}
                          onBlur={field.handleBlur}
                        />
                        <span className="flex select-none items-center pe-3 text-muted-foreground">
                          PKR
                        </span>
                      </NumberFieldGroup>
                    </NumberField>
                    {invalid && <FormFieldError errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            />
          </div>

          <form.Field
            name="unitPrice"
            children={(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={field.name}>Unit price</FieldLabel>
                  <NumberField
                    format={{ maximumFractionDigits: 0 }}
                    id={field.name}
                    min={0}
                    onValueChange={(value) =>
                      field.handleChange(value === null ? "" : String(value))
                    }
                    step={1}
                    value={numberFieldValue(field.state.value)}
                  >
                    <NumberFieldGroup>
                      <NumberFieldInput
                        aria-invalid={invalid}
                        className="text-left"
                        name={field.name}
                        onBlur={field.handleBlur}
                      />
                      <span className="flex select-none items-center pe-3 text-muted-foreground">
                        PKR
                      </span>
                    </NumberFieldGroup>
                  </NumberField>
                  <FieldDescription>
                    Auto-filled from pack price ÷ units per pack, rounded. Edit to override.
                  </FieldDescription>
                  {invalid && <FormFieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          />
        </Fieldset>
      </Fieldset>
    </form>
  );
}

function EditProductFields({
  categories,
  onUpdated,
  product,
}: {
  categories: ReadonlyArray<Category>;
  onUpdated: () => void;
  product: Product;
}) {
  const form = useProductUpdateForm(product, onUpdated);

  return (
    <>
      <ProductForm categories={categories} form={form} formId="edit-product-form" />
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => state.canSubmit}>
          {(canSubmit) => (
            <Button disabled={!canSubmit} form="edit-product-form" type="submit">
              Save changes
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </>
  );
}

function EditProductDialog({
  categories,
  product,
}: {
  categories: ReadonlyArray<Category>;
  product: Product;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={<Button size="icon" variant="ghost" />}>
        <HugeiconsIcon aria-hidden="true" icon={PencilEdit02Icon} />
      </DialogTrigger>
      <DialogContent className={"min-w-[50vw]"}>
        <DialogHeader>
          <DialogTitle>Edit product</DialogTitle>
          <DialogDescription>Update the catalog details for this product.</DialogDescription>
        </DialogHeader>
        {open && (
          <EditProductFields
            categories={categories}
            onUpdated={() => {
              setOpen(false);
              void router.invalidate();
            }}
            product={product}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export { EditProductDialog, ProductForm, useProductCreateForm };
