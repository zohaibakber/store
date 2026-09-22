import type { Category, Product, ProductSuggestions } from "@store/contracts";
import { formOptions, useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { CategoryField } from "@/components/products/category-field";
import { SuggestField } from "@/components/products/suggest-field";
import {
  ControlGroup,
  ControlGroupAddon,
  ControlGroupNumberInput,
  ControlGroupText,
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
import { formValidator } from "@/lib/form-schema";
import { useInventoryActions } from "@/lib/inventory-db";

const strengthUnits = ["mg", "mcg", "g", "ml", "l"] as const;
type StrengthUnit = (typeof strengthUnits)[number];
const strengthUnitItems = strengthUnits.map((unit) => ({ label: unit, value: unit }));
const strengthUnitSet: ReadonlySet<string> = new Set(strengthUnits);
const isStrengthUnit = (value: string): value is StrengthUnit => strengthUnitSet.has(value);

const optionalPrice = Schema.String.check(
  Schema.makeFilter((value) =>
    value === "" || (Number.isFinite(Number(value)) && Number(value) >= 0)
      ? undefined
      : "Enter a valid price or leave this blank.",
  ),
);

const productFormSchema = formValidator(
  Schema.Struct({
    name: Schema.Trim.check(
      Schema.isMinLength(1, { message: "Product name is required." }),
      Schema.isMaxLength(120),
    ),
    categoryId: Schema.String.check(Schema.isMinLength(1, { message: "Category is required." })),
    aisle: Schema.Trim.check(Schema.isMaxLength(64)),
    composition: Schema.Trim.check(Schema.isMaxLength(160)),
    strength: Schema.Trim.check(Schema.isMaxLength(20)),
    strengthUnit: Schema.Literals(strengthUnits),
    unitsPerPack: Schema.String.check(
      Schema.makeFilter((value) =>
        value === "" || (Number.isInteger(Number(value)) && Number(value) >= 1)
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

const parseStrength = (value: string | null): ParsedStrength => {
  const match = value?.match(/^([\d.]+)\s*(mg|mcg|g|ml|l)$/i);
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

/**
 * A category that isn't sold in packs hides pack size and pack retail, so
 * those values must not reach the store. Purchase price is always the pack
 * cost. Retail for a single-unit category lives on unit price.
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

function useProductCreateForm(categories: ReadonlyArray<Category>) {
  const navigate = useNavigate();
  const { createProduct } = useInventoryActions();

  return useForm({
    ...productFormOpts,
    defaultValues: { ...productFormOpts.defaultValues, categoryId: defaultCategoryId(categories) },
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
      <Fieldset className="flex w-full flex-col">
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

        <Fieldset className="grid sm:grid-cols-2">
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

        <Fieldset className="grid sm:grid-cols-2">
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
                            <SelectTrigger aria-label="Strength unit" size="sm">
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
              <UnitPricingFields form={form} />
            )
          }
        </form.Subscribe>
      </Fieldset>
    </form>
  );
}

function PurchasePriceField({ form }: { form: ReturnType<typeof useProductCreateForm> }) {
  return (
    <Fieldset className="flex flex-col">
      <p className="text-sm font-medium">Purchase price</p>
      <form.Field
        name="purchasePrice"
        children={(field) => (
          <FormField
            description="Cost of one pack. Leave blank if you do not track cost."
            field={field}
            label="Purchase price"
          >
            {(control) => (
              <PriceInput control={control} field={field} fractionDigits={2} step={0.01} />
            )}
          </FormField>
        )}
      />
    </Fieldset>
  );
}

function PackPricingFields({ form }: { form: ReturnType<typeof useProductCreateForm> }) {
  return (
    <Fieldset className="flex flex-col">
      <UnitsPerPackField form={form} />
      <PurchasePriceField form={form} />
      <Fieldset className="flex flex-col">
        <p className="text-sm font-medium">Retail price</p>
        <PackRetailFields form={form} />
      </Fieldset>
    </Fieldset>
  );
}

function UnitPricingFields({ form }: { form: ReturnType<typeof useProductCreateForm> }) {
  return (
    <Fieldset className="flex flex-col">
      <PurchasePriceField form={form} />
      <Fieldset className="flex flex-col">
        <p className="text-sm font-medium">Retail price</p>
        <UnitRetailField form={form} />
      </Fieldset>
    </Fieldset>
  );
}

function UnitsPerPackField({ form }: { form: ReturnType<typeof useProductCreateForm> }) {
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
  );
}

function PackRetailFields({ form }: { form: ReturnType<typeof useProductCreateForm> }) {
  return (
    <Fieldset className="grid sm:grid-cols-2">
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
          <FormField field={field} label="Retail price">
            {(control) => (
              <PriceInput control={control} field={field} fractionDigits={2} step={0.01} />
            )}
          </FormField>
        )}
      />
      <form.Field
        name="unitPrice"
        children={(field) => (
          <FormField
            description="Auto-filled from retail price ÷ units per pack, rounded. Edit to override."
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

function UnitRetailField({ form }: { form: ReturnType<typeof useProductCreateForm> }) {
  return (
    <form.Field
      name="unitPrice"
      children={(field) => (
        <FormField field={field} label="Retail price">
          {(control) => <PriceInput control={control} field={field} fractionDigits={0} step={1} />}
        </FormField>
      )}
    />
  );
}

export { ProductForm, categoryTracksPacks, useProductCreateForm, useProductUpdateForm };
