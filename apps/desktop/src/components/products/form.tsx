import {
  INT4_MAX,
  MAX_CATALOG_NAME_LENGTH,
  type Category,
  type Product,
  type ProductSuggestions,
} from "@store/contracts";
import { useInventoryActions } from "@store/inventory-react";
import { formOptions, useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { CategoryField } from "@/components/products/category-field";
import { SuggestField } from "@/components/products/suggest-field";
import { NumberControl } from "@/components/shared/control-group";
import { FormField, type FormControlProps } from "@/components/shared/form-field";
import { Fieldset } from "@/components/ui/fieldset";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "@/components/ui/number-field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toastManager } from "@/components/ui/toast";
import { toastStoreError } from "@/lib/errors";
import { formatNumber } from "@/lib/format";
import { lenientSearchParam } from "@/lib/search-param";

const strengthUnits = ["mg", "mcg", "g", "ml", "l"] as const;
type StrengthUnit = (typeof strengthUnits)[number];
const strengthUnitItems = strengthUnits.map((unit) => ({ label: unit, value: unit }));
const strengthUnitSet: ReadonlySet<string> = new Set(strengthUnits);
const isStrengthUnit = (value: string): value is StrengthUnit => strengthUnitSet.has(value);

const MAX_PRICE = INT4_MAX / 100;

const atMost = (length: number, label: string) =>
  Schema.isMaxLength(length, { message: `${label} can be at most ${length} characters.` });

const optionalPrice = Schema.String.check(
  Schema.makeFilter((value) => {
    if (value === "") return undefined;
    const price = Number(value);
    if (!Number.isFinite(price) || price < 0) return "Enter a valid price or leave this blank.";
    return price > MAX_PRICE ? `Enter a price of ${formatNumber(MAX_PRICE)} or less.` : undefined;
  }),
);

const productFormSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    name: Schema.Trim.check(
      Schema.isMinLength(1, { message: "Product name is required." }),
      atMost(MAX_CATALOG_NAME_LENGTH, "Product name"),
    ),
    categoryId: Schema.String.check(Schema.isMinLength(1, { message: "Category is required." })),
    aisle: Schema.Trim.check(atMost(64, "Aisle")),
    composition: Schema.Trim.check(atMost(160, "Composition")),
    strength: Schema.Trim.check(atMost(20, "Strength")),
    strengthUnit: Schema.Literals(strengthUnits),
    unitsPerPack: Schema.String.check(
      Schema.makeFilter((value) =>
        value === "" ||
        (Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= INT4_MAX)
          ? undefined
          : "Units per pack must be a whole number of 1 or more.",
      ),
    ),
    purchasePrice: optionalPrice,
    retailPrice: optionalPrice,
    unitPrice: optionalPrice,
  }),
);

const nullableText = (value: string) => value.trim() || null;
const priceInPaisa = (value: string) => (value === "" ? null : Math.round(Number(value) * 100));
const priceFromPaisa = (value: number | null) => (value == null ? "" : String(value / 100));
const numberFieldValue = (value: string) => (value === "" ? null : Number(value));

const computeUnitPrice = (unitsPerPack: string, retailPrice: string) => {
  const units = Number(unitsPerPack);
  const retail = Number(retailPrice);
  if (retailPrice === "" || !Number.isFinite(units) || units < 1 || !Number.isFinite(retail)) {
    return null;
  }
  return String(Math.round(retail / units));
};

type ParsedStrength = {
  strength: string;
  strengthUnit: StrengthUnit;
};

const STRENGTH_WITH_UNIT = /^([\d.]+)\s*(mg|mcg|g|ml|l)$/i;

const parseStrength = (value: string | null): ParsedStrength => {
  const match = value?.match(STRENGTH_WITH_UNIT);
  if (!match) {
    return { strength: value ?? "", strengthUnit: "mg" };
  }
  const unit = match[2].toLowerCase();
  return {
    strength: match[1],
    strengthUnit: isStrengthUnit(unit) ? unit : "mg",
  };
};

type ProductFormValues = {
  name: string;
  categoryId: string;
  aisle: string;
  composition: string;
  strength: string;
  strengthUnit: StrengthUnit;
  unitsPerPack: string;
  purchasePrice: string;
  retailPrice: string;
  unitPrice: string;
};

const productFormDefaults: ProductFormValues = {
  name: "",
  categoryId: "",
  aisle: "",
  composition: "",
  strength: "",
  strengthUnit: "mg",
  unitsPerPack: "",
  purchasePrice: "",
  retailPrice: "",
  unitPrice: "",
};

const productFormOpts = formOptions({
  defaultValues: productFormDefaults,
  validators: { onSubmit: productFormSchema },
});

const formValuesToInput = (value: ProductFormValues, tracksPacks: boolean) => {
  const strength = value.strength.trim();
  return {
    name: value.name.trim(),
    categoryId: value.categoryId,
    aisle: nullableText(value.aisle),
    composition: nullableText(value.composition),
    strength: strength ? `${strength}${value.strengthUnit}` : null,
    unitsPerPack: tracksPacks ? Number(value.unitsPerPack || 1) : 1,
    purchasePrice: priceInPaisa(value.purchasePrice),
    retailPrice: tracksPacks ? priceInPaisa(value.retailPrice) : null,
    unitPrice: priceInPaisa(value.unitPrice),
  };
};

const categoryTracksPacks = (categories: ReadonlyArray<Category>, categoryId: string): boolean =>
  categories.find((category) => category.id === categoryId)?.tracksPacks ?? true;

const defaultCategoryId = (categories: ReadonlyArray<Category>): string => categories[0]?.id ?? "";

const productToFormValues = (product: Product): ProductFormValues => {
  const { strength, strengthUnit } = parseStrength(product.strength);
  return {
    name: product.name,
    categoryId: product.categoryId,
    aisle: product.aisle ?? "",
    composition: product.composition ?? "",
    strength,
    strengthUnit,
    unitsPerPack: String(product.unitsPerPack),
    purchasePrice: priceFromPaisa(product.purchasePrice),
    retailPrice: priceFromPaisa(product.retailPrice),
    unitPrice: priceFromPaisa(product.unitPrice),
  };
};

const ProductPrefill = Schema.Struct({
  name: lenientSearchParam(
    Schema.Trimmed.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_CATALOG_NAME_LENGTH)),
  ),
  composition: lenientSearchParam(
    Schema.Trimmed.check(Schema.isMinLength(1), Schema.isMaxLength(160)),
  ),
  strength: lenientSearchParam(Schema.String.check(Schema.isPattern(STRENGTH_WITH_UNIT))),
  unitsPerPack: lenientSearchParam(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(INT4_MAX)),
  ),
});
type ProductPrefill = typeof ProductPrefill.Type;

const prefilledFormValues = (
  base: ProductFormValues,
  prefill: ProductPrefill,
): ProductFormValues => {
  const strength = prefill.strength === undefined ? base : parseStrength(prefill.strength);
  return {
    ...base,
    name: prefill.name ?? base.name,
    composition: prefill.composition ?? base.composition,
    strength: strength.strength,
    strengthUnit: strength.strengthUnit,
    unitsPerPack:
      prefill.unitsPerPack === undefined ? base.unitsPerPack : String(prefill.unitsPerPack),
  };
};

function useProductCreateForm(categories: ReadonlyArray<Category>, prefill: ProductPrefill = {}) {
  const navigate = useNavigate();
  const { createProduct } = useInventoryActions();

  return useForm({
    ...productFormOpts,
    defaultValues: prefilledFormValues(
      { ...productFormOpts.defaultValues, categoryId: defaultCategoryId(categories) },
      prefill,
    ),
    onSubmit: async ({ value }) => {
      try {
        const product = await createProduct(
          formValuesToInput(value, categoryTracksPacks(categories, value.categoryId)),
        );
        toastManager.add({ title: "Product created", type: "success" });
        await navigate({ to: "/products/$productId", params: { productId: product.id } });
      } catch (error) {
        toastStoreError(error, "Could not create the product.");
      }
    },
  });
}

function useProductUpdateForm(
  product: Product,
  categories: ReadonlyArray<Category>,
  onUpdated: () => void,
) {
  const { updateProduct } = useInventoryActions();
  return useForm({
    ...productFormOpts,
    defaultValues: productToFormValues(product),
    onSubmit: async ({ value }) => {
      try {
        await updateProduct({
          id: product.id,
          ...formValuesToInput(value, categoryTracksPacks(categories, value.categoryId)),
        });
        toastManager.add({ title: "Product updated", type: "success" });
        onUpdated();
      } catch (error) {
        toastStoreError(error, "Could not update the product.");
      }
    },
  });
}

type PriceField = {
  handleBlur: () => void;
  handleChange: (value: string) => void;
  state: { value: string };
};

function PriceInput({
  control,
  field,
  fractionDigits,
  step,
}: {
  control: FormControlProps;
  field: PriceField;
  fractionDigits: number;
  step: number;
}) {
  return (
    <NumberControl
      addon="PKR"
      format={{ maximumFractionDigits: fractionDigits }}
      id={control.id}
      inputProps={{
        className: "text-start",
        "aria-invalid": control["aria-invalid"],
        name: control.name,
        onBlur: field.handleBlur,
      }}
      min={0}
      onValueChange={(value) => field.handleChange(value === null ? "" : String(value))}
      step={step}
      value={numberFieldValue(field.state.value)}
    />
  );
}

type ProductFormApi = ReturnType<typeof useProductCreateForm>;

function ProductForm({
  categories,
  form,
  formId,
  suggestions,
}: {
  categories: ReadonlyArray<Category>;
  form: ProductFormApi;
  formId: string;
  suggestions: ProductSuggestions;
}) {
  return (
    <form
      id={formId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <Fieldset className="w-full">
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-6">
          <div className="sm:col-span-6">
            <form.Field
              name="name"
              children={(field) => (
                <FormField field={field} label="Name">
                  {(control, invalid) => (
                    <SuggestField
                      autoFocus
                      emptyMessage="No matching product."
                      id={control.id}
                      invalid={invalid}
                      name={control.name}
                      onBlur={field.handleBlur}
                      onChange={(name) => field.handleChange(name)}
                      placeholder="e.g. Panadol"
                      suggestions={suggestions.names}
                      value={field.state.value}
                    />
                  )}
                </FormField>
              )}
            />
          </div>
          <div className="sm:col-span-3">
            <form.Field
              name="categoryId"
              children={(field) => (
                <FormField field={field} label="Category">
                  {(control, invalid) => (
                    <CategoryField
                      id={control.id}
                      invalid={invalid}
                      name={control.name}
                      onChange={(categoryId) => field.handleChange(categoryId)}
                      seed={categories}
                      value={field.state.value}
                    />
                  )}
                </FormField>
              )}
            />
          </div>
          <div className="sm:col-span-3">
            <form.Field
              name="composition"
              children={(field) => (
                <FormField field={field} label="Composition">
                  {(control, invalid) => (
                    <SuggestField
                      emptyMessage="No matching composition."
                      id={control.id}
                      invalid={invalid}
                      name={control.name}
                      onBlur={field.handleBlur}
                      onChange={(composition) => field.handleChange(composition)}
                      placeholder="e.g. Paracetamol"
                      suggestions={suggestions.compositions}
                      value={field.state.value}
                    />
                  )}
                </FormField>
              )}
            />
          </div>
          <div className="sm:col-span-3">
            <StrengthField form={form} />
          </div>
          <form.Subscribe selector={(state) => state.values.categoryId}>
            {(categoryId) =>
              categoryTracksPacks(categories, categoryId) ? (
                <>
                  <div className="sm:col-span-3">
                    <UnitsPerPackField form={form} />
                  </div>
                  <Separator className="sm:col-span-6" />
                  <div className="sm:col-span-2">
                    <PurchasePriceField description="Cost of one pack" form={form} />
                  </div>
                  <div className="sm:col-span-2">
                    <PackRetailField form={form} />
                  </div>
                  <div className="sm:col-span-2">
                    <UnitPriceField
                      description="Retail ÷ units per pack"
                      form={form}
                      label="Unit price"
                    />
                  </div>
                </>
              ) : (
                <>
                  <Separator className="sm:col-span-6" />
                  <div className="sm:col-span-3">
                    <PurchasePriceField form={form} />
                  </div>
                  <div className="sm:col-span-3">
                    <UnitPriceField form={form} label="Retail price" />
                  </div>
                </>
              )
            }
          </form.Subscribe>
          <div className="sm:col-span-3">
            <form.Field
              name="aisle"
              children={(field) => (
                <FormField field={field} label="Aisle">
                  {(control, invalid) => (
                    <SuggestField
                      emptyMessage="No matching aisle."
                      id={control.id}
                      invalid={invalid}
                      name={control.name}
                      onBlur={field.handleBlur}
                      onChange={(aisle) => field.handleChange(aisle)}
                      placeholder="e.g. A3"
                      suggestions={suggestions.aisles}
                      value={field.state.value}
                    />
                  )}
                </FormField>
              )}
            />
          </div>
        </div>
      </Fieldset>
    </form>
  );
}

function StrengthField({ form }: { form: ProductFormApi }) {
  return (
    <form.Field
      name="strength"
      children={(field) => (
        <FormField field={field} label="Strength">
          {(control) => (
            <NumberControl
              addon={
                <form.Field
                  name="strengthUnit"
                  children={(unitField) => (
                    <Select
                      items={strengthUnitItems}
                      name={unitField.name}
                      onValueChange={(value) => value && unitField.handleChange(value)}
                      value={unitField.state.value}
                    >
                      <SelectTrigger aria-label="Strength unit" id={`${control.id}-unit`} size="sm">
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
              }
              format={{ maximumFractionDigits: 2 }}
              id={control.id}
              inputProps={{
                className: "text-start",
                "aria-invalid": control["aria-invalid"],
                name: control.name,
                onBlur: field.handleBlur,
                placeholder: "e.g. 500",
              }}
              min={0}
              onValueChange={(value) => field.handleChange(value === null ? "" : String(value))}
              value={numberFieldValue(field.state.value)}
            />
          )}
        </FormField>
      )}
    />
  );
}

function PurchasePriceField({ description, form }: { description?: string; form: ProductFormApi }) {
  return (
    <form.Field
      name="purchasePrice"
      children={(field) => (
        <FormField description={description} field={field} label="Purchase price">
          {(control) => (
            <PriceInput control={control} field={field} fractionDigits={2} step={0.01} />
          )}
        </FormField>
      )}
    />
  );
}

function UnitsPerPackField({ form }: { form: ProductFormApi }) {
  return (
    <form.Field
      listeners={{
        onChange: ({ value, fieldApi }) => {
          const retailPrice = fieldApi.form.getFieldValue("retailPrice");
          const unitPrice = computeUnitPrice(value, retailPrice);
          if (unitPrice !== null) {
            fieldApi.form.setFieldValue("unitPrice", unitPrice);
          }
        },
      }}
      name="unitsPerPack"
      children={(field) => (
        <FormField field={field} label="Units per pack">
          {(control) => (
            <NumberField
              format={{ maximumFractionDigits: 0 }}
              id={control.id}
              min={1}
              onValueChange={(value) => field.handleChange(value === null ? "" : String(value))}
              step={1}
              value={numberFieldValue(field.state.value)}
            >
              <NumberFieldGroup>
                <NumberFieldInput
                  className="text-start"
                  aria-invalid={control["aria-invalid"]}
                  name={control.name}
                  onBlur={field.handleBlur}
                  placeholder="1"
                />
              </NumberFieldGroup>
            </NumberField>
          )}
        </FormField>
      )}
    />
  );
}

function PackRetailField({ form }: { form: ProductFormApi }) {
  return (
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
      name="retailPrice"
      children={(field) => (
        <FormField description="Price of one pack" field={field} label="Retail price">
          {(control) => (
            <PriceInput control={control} field={field} fractionDigits={2} step={0.01} />
          )}
        </FormField>
      )}
    />
  );
}

function UnitPriceField({
  description,
  form,
  label,
}: {
  description?: string;
  form: ProductFormApi;
  label: string;
}) {
  return (
    <form.Field
      name="unitPrice"
      children={(field) => (
        <FormField description={description} field={field} label={label}>
          {(control) => <PriceInput control={control} field={field} fractionDigits={0} step={1} />}
        </FormField>
      )}
    />
  );
}

export { ProductForm, ProductPrefill, useProductCreateForm, useProductUpdateForm };
