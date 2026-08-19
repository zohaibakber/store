import type { Category, Product, ProductSuggestions } from "@store/contracts";
import { formOptions, useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import * as z from "zod";

import { CategoryField } from "@/components/products/category-field";
import { SuggestField } from "@/components/products/suggest-field";
import {
  ControlGroup,
  ControlGroupAddon,
  ControlGroupNumberInput,
  ControlGroupText,
  controlGroupSelectTrigger,
} from "@/components/shared/control-group";
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
import { toastManager } from "@/components/ui/toast";
import { toastStoreError } from "@/lib/errors";
import { useStore } from "@/lib/store";

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
  // Blank means one: an item sold as-is has no pack size to state, and a
  // category that isn't sold in packs never shows the field at all.
  unitsPerPack: z
    .string()
    .refine((value) => value === "" || (Number.isInteger(Number(value)) && Number(value) >= 1), {
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
  if (!match) {
    // SAFETY: The fallback literal is a member of the closed strengthUnits tuple.
    return { strength: value ?? "", strengthUnit: "mg" as (typeof strengthUnits)[number] };
  }
  // SAFETY: The regex capture is restricted to the same closed unit alternatives.
  return {
    strength: match[1],
    strengthUnit: match[2].toLowerCase() as (typeof strengthUnits)[number],
  };
};

const productFormOpts = formOptions({
  defaultValues: {
    name: "",
    categoryId: "",
    aisle: "",
    composition: "",
    strength: "",
    // SAFETY: The default literal is a member of the closed strengthUnits tuple.
    strengthUnit: "mg" as (typeof strengthUnits)[number],
    unitsPerPack: "",
    packPrice: "",
    unitPrice: "",
  },
  validators: { onSubmit: productFormSchema },
});

type ProductFormValues = typeof productFormOpts.defaultValues;

/**
 * A category that isn't sold in packs hides the pack fields, so whatever is
 * sitting in them, from a category change or an earlier edit, must not reach
 * the store. One unit per pack and no pack price is what such a product is.
 */
const formValuesToInput = (value: ProductFormValues, tracksPacks: boolean) => {
  const strength = value.strength.trim();
  return {
    name: value.name.trim(),
    categoryId: value.categoryId,
    aisle: nullableText(value.aisle),
    composition: nullableText(value.composition),
    strength: strength ? `${strength}${value.strengthUnit}` : null,
    unitsPerPack: tracksPacks ? Number(value.unitsPerPack || 1) : 1,
    packPrice: tracksPacks ? priceInPaisa(value.packPrice) : null,
    unitPrice: priceInPaisa(value.unitPrice),
  };
};

const categoryTracksPacks = (categories: ReadonlyArray<Category>, categoryId: string): boolean =>
  categories.find((category) => category.id === categoryId)?.tracksPacks ?? true;

const defaultCategoryId = (categories: ReadonlyArray<Category>) => categories[0]?.id ?? "";

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
  const store = useStore();

  return useForm({
    ...productFormOpts,
    defaultValues: { ...productFormOpts.defaultValues, categoryId: defaultCategoryId(categories) },
    onSubmit: async ({ value }) => {
      try {
        const product = await store.createProduct(
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
  const store = useStore();
  return useForm({
    ...productFormOpts,
    defaultValues: productToFormValues(product),
    onSubmit: async ({ value }) => {
      try {
        await store.updateProduct({
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
    <ControlGroup>
      <ControlGroupNumberInput
        format={{ maximumFractionDigits: fractionDigits }}
        id={control.id}
        inputProps={{
          "aria-invalid": control["aria-invalid"],
          name: control.name,
          onBlur: field.handleBlur,
        }}
        min={0}
        onValueChange={(value) => field.handleChange(value === null ? "" : String(value))}
        step={step}
        value={numberFieldValue(field.state.value)}
      />
      <ControlGroupAddon>
        <ControlGroupText>PKR</ControlGroupText>
      </ControlGroupAddon>
    </ControlGroup>
  );
}

function ProductForm({
  categories,
  form,
  formId,
  suggestions,
}: {
  categories: ReadonlyArray<Category>;
  form: ReturnType<typeof useProductCreateForm>;
  formId: string;
  suggestions: ProductSuggestions;
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
          children={(field) => (
            <FormField field={field} label="Product name">
              {(control, invalid) => (
                <SuggestField
                  autoFocus
                  emptyMessage="No matching product."
                  id={control.id}
                  invalid={invalid}
                  name={control.name}
                  onBlur={field.handleBlur}
                  onChange={(name) => field.handleChange(name)}
                  placeholder="e.g. Panadol 500mg"
                  suggestions={suggestions.names}
                  value={field.state.value}
                />
              )}
            </FormField>
          )}
        />

        <Fieldset className="grid gap-4 sm:grid-cols-2">
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
        </Fieldset>

        <Fieldset className="grid gap-4 sm:grid-cols-2">
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
          <form.Field
            name="strength"
            children={(field) => (
              <FormField field={field} label="Strength">
                {(control) => (
                  <ControlGroup>
                    <ControlGroupNumberInput
                      format={{ maximumFractionDigits: 2 }}
                      id={control.id}
                      inputProps={{
                        "aria-invalid": control["aria-invalid"],
                        "aria-label": "Strength value",
                        name: control.name,
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
                )}
              </FormField>
            )}
          />
        </Fieldset>

        <form.Subscribe selector={(state) => state.values.categoryId}>
          {(categoryId) =>
            categoryTracksPacks(categories, categoryId) ? (
              <PackPricingFields form={form} />
            ) : (
              <SingleUnitPricingField form={form} />
            )
          }
        </form.Subscribe>
      </Fieldset>
    </form>
  );
}

/** Sold in packs: pack size, pack price, and the unit price derived from them. */
function PackPricingFields({ form }: { form: ReturnType<typeof useProductCreateForm> }) {
  return (
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
          children={(field) => (
            <FormField
              description="Use 1 when the item is sold as-is."
              field={field}
              label="Units per pack"
            >
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
                      aria-invalid={control["aria-invalid"]}
                      className="text-left"
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
          children={(field) => (
            <FormField field={field} label="Pack price">
              {(control) => (
                <PriceInput control={control} field={field} fractionDigits={2} step={0.01} />
              )}
            </FormField>
          )}
        />
      </div>

      <form.Field
        name="unitPrice"
        children={(field) => (
          <FormField
            description="Auto-filled from pack price ÷ units per pack, rounded. Edit to override."
            field={field}
            label="Unit price"
          >
            {(control) => (
              <PriceInput control={control} field={field} fractionDigits={0} step={1} />
            )}
          </FormField>
        )}
      />
    </Fieldset>
  );
}

/** Sold one at a time: a single price, and no pack size to state. */
function SingleUnitPricingField({ form }: { form: ReturnType<typeof useProductCreateForm> }) {
  return (
    <Fieldset className="grid gap-4 sm:grid-cols-2">
      <form.Field
        name="unitPrice"
        children={(field) => (
          <FormField field={field} label="Price">
            {(control) => (
              <PriceInput control={control} field={field} fractionDigits={0} step={1} />
            )}
          </FormField>
        )}
      />
    </Fieldset>
  );
}

export { ProductForm, categoryTracksPacks, useProductCreateForm, useProductUpdateForm };
