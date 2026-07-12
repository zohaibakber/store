import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import type { Category } from "@store/contracts";
import { toast } from "sonner";
import * as z from "zod";
import { ButtonGroup } from "@/components/ui/button-group";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NumberField,
  NumberFieldAddon,
  NumberFieldGroup,
  NumberFieldInput,
} from "@/components/ui/number-field";
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
  barcode: z.string().trim().max(64),
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
const numberFieldValue = (value: string) => (value === "" ? null : Number(value));

const computeUnitPrice = (unitsPerPack: string, packPrice: string) => {
  const units = Number(unitsPerPack);
  const pack = Number(packPrice);
  if (packPrice === "" || !Number.isFinite(units) || units < 1 || !Number.isFinite(pack)) {
    return null;
  }
  return String(Math.round(pack / units));
};

function useProductCreateForm(categories: ReadonlyArray<Category>) {
  const navigate = useNavigate();

  return useForm({
    defaultValues: {
      name: "",
      categoryId:
        categories.find((category) => category.id === "general")?.id ?? categories[0]?.id ?? "",
      barcode: "",
      aisle: "",
      composition: "",
      strength: "",
      strengthUnit: "mg" as (typeof strengthUnits)[number],
      unitsPerPack: "1",
      packPrice: "",
      unitPrice: "",
    },
    validators: { onSubmit: productFormSchema },
    onSubmit: async ({ value }) => {
      try {
        const strengthValue = value.strength.trim();
        const product = await window.offlineStore.createProduct({
          name: value.name.trim(),
          categoryId: value.categoryId,
          barcode: nullableText(value.barcode),
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

function ProductsCreateForm({
  categories,
  form,
}: {
  categories: ReadonlyArray<Category>;
  form: ReturnType<typeof useProductCreateForm>;
}) {
  return (
    <form
      id="new-product-form"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
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
                {invalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        />

        <FieldGroup className="grid gap-4 sm:grid-cols-3">
          <form.Field
            name="categoryId"
            children={(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={field.name}>Category</FieldLabel>
                  <Select
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
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          />
          <form.Field
            name="barcode"
            children={(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={field.name}>Barcode</FieldLabel>
                  <Input
                    aria-invalid={invalid}
                    id={field.name}
                    inputMode="numeric"
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Optional"
                    value={field.state.value}
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
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
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          />
        </FieldGroup>

        <FieldGroup className="grid gap-4 sm:grid-cols-2">
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
                  {invalid && <FieldError errors={field.state.meta.errors} />}
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
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          />
        </FieldGroup>

        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <FieldGroup className="grid grid-cols-2 gap-4">
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
                        />
                      </NumberFieldGroup>
                    </NumberField>
                    <FieldDescription>Use 1 when the item is sold as-is.</FieldDescription>
                    {invalid && <FieldError errors={field.state.meta.errors} />}
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
                        <NumberFieldAddon align="inline-end">PKR</NumberFieldAddon>
                      </NumberFieldGroup>
                    </NumberField>
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            />
          </FieldGroup>

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
                      <NumberFieldAddon align="inline-end">PKR</NumberFieldAddon>
                    </NumberFieldGroup>
                  </NumberField>
                  <FieldDescription>
                    Auto-filled from pack price ÷ units per pack, rounded. Edit to override.
                  </FieldDescription>
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          />
        </FieldGroup>
      </FieldGroup>
    </form>
  );
}

export { ProductsCreateForm, useProductCreateForm };
