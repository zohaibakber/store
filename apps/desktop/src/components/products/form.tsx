import type { Category, Product } from "@store/contracts";
import { formOptions, useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import * as z from "zod";

import {
  ControlGroup,
  ControlGroupAddon,
  ControlGroupNumberInput,
  ControlGroupText,
  controlGroupSelectTrigger,
} from "@/components/control-group";
import { FormFieldError } from "@/components/form-field-error";
import { CategoryField } from "@/components/products/category-field";
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
import { toastManager } from "@/components/ui/toast";

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
        toastManager.add({ title: "Product created", type: "success" });
        await navigate({ to: "/products/$productId", params: { productId: product.id } });
      } catch (error) {
        toastManager.add({
          title: error instanceof Error ? error.message : "Could not create the product.",
          type: "error",
        });
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
        toastManager.add({ title: "Product updated", type: "success" });
        onUpdated();
      } catch (error) {
        toastManager.add({
          title: error instanceof Error ? error.message : "Could not update the product.",
          type: "error",
        });
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
                  aria-invalid={invalid || undefined}
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
                  <CategoryField
                    id={field.name}
                    invalid={invalid}
                    name={field.name}
                    onChange={(categoryId) => field.handleChange(categoryId)}
                    seed={categories}
                    value={field.state.value}
                  />
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
                    aria-invalid={invalid || undefined}
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
                    aria-invalid={invalid || undefined}
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
                  <ControlGroup>
                    <ControlGroupNumberInput
                      format={{ maximumFractionDigits: 2 }}
                      id={field.name}
                      inputProps={{
                        "aria-invalid": invalid || undefined,
                        "aria-label": "Strength value",
                        name: field.name,
                        onBlur: field.handleBlur,
                        placeholder: "e.g. 500",
                      }}
                      min={0}
                      onValueChange={(value) =>
                        field.handleChange(value === null ? "" : String(value))
                      }
                      value={numberFieldValue(field.state.value)}
                    />
                    <ControlGroupAddon>
                      <form.Field
                        name="strengthUnit"
                        children={(unitField) => (
                          <Select
                            items={strengthUnitItems}
                            name={unitField.name}
                            onValueChange={(value) => value && unitField.handleChange(value)}
                            value={unitField.state.value}
                          >
                            <SelectTrigger
                              aria-label="Strength unit"
                              className={controlGroupSelectTrigger}
                              size="sm"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
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
                    </ControlGroupAddon>
                  </ControlGroup>
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
                          aria-invalid={invalid || undefined}
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
                    <ControlGroup>
                      <ControlGroupNumberInput
                        format={{ maximumFractionDigits: 2 }}
                        id={field.name}
                        inputProps={{
                          "aria-invalid": invalid || undefined,
                          name: field.name,
                          onBlur: field.handleBlur,
                        }}
                        min={0}
                        onValueChange={(value) =>
                          field.handleChange(value === null ? "" : String(value))
                        }
                        step={0.01}
                        value={numberFieldValue(field.state.value)}
                      />
                      <ControlGroupAddon>
                        <ControlGroupText>PKR</ControlGroupText>
                      </ControlGroupAddon>
                    </ControlGroup>
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
                  <ControlGroup>
                    <ControlGroupNumberInput
                      format={{ maximumFractionDigits: 0 }}
                      id={field.name}
                      inputProps={{
                        "aria-invalid": invalid || undefined,
                        name: field.name,
                        onBlur: field.handleBlur,
                      }}
                      min={0}
                      onValueChange={(value) =>
                        field.handleChange(value === null ? "" : String(value))
                      }
                      step={1}
                      value={numberFieldValue(field.state.value)}
                    />
                    <ControlGroupAddon>
                      <ControlGroupText>PKR</ControlGroupText>
                    </ControlGroupAddon>
                  </ControlGroup>
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

export { ProductForm, useProductCreateForm, useProductUpdateForm };
