import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import * as z from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

const optionalPrice = z
  .string()
  .refine((value) => value === "" || (Number.isFinite(Number(value)) && Number(value) >= 0), {
    message: "Enter a valid price or leave this blank.",
  });

const productFormSchema = z.object({
  name: z.string().trim().min(1, "Product name is required.").max(120),
  category: z.enum(["medicine", "cosmetics", "general"]),
  barcode: z.string().trim().max(64),
  composition: z.string().trim().max(160),
  strength: z.string().trim().max(80),
  unitsPerPack: z
    .string()
    .refine((value) => Number.isInteger(Number(value)) && Number(value) >= 1, {
      message: "Units per pack must be a whole number of 1 or more.",
    }),
  costPrice: optionalPrice,
  packPrice: optionalPrice,
  unitPrice: optionalPrice,
});

const nullableText = (value: string) => value.trim() || null;
const priceInPaisa = (value: string) => (value === "" ? null : Math.round(Number(value) * 100));

export const Route = createFileRoute("/products/new")({
  component: NewProductPage,
});

function NewProductPage() {
  const navigate = useNavigate();
  const form = useForm({
    defaultValues: {
      name: "",
      category: "general" as "medicine" | "cosmetics" | "general",
      barcode: "",
      composition: "",
      strength: "",
      unitsPerPack: "1",
      costPrice: "",
      packPrice: "",
      unitPrice: "",
    },
    validators: { onSubmit: productFormSchema },
    onSubmit: async ({ value }) => {
      try {
        const product = await window.offlineStore.createProduct({
          name: value.name.trim(),
          category: value.category,
          barcode: nullableText(value.barcode),
          composition: nullableText(value.composition),
          strength: nullableText(value.strength),
          unitsPerPack: Number(value.unitsPerPack),
          costPrice: priceInPaisa(value.costPrice),
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

  return (
    <main className="p-6 md:p-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Add product</h1>
          <p className="mt-1 text-muted-foreground">
            Add an item to the local catalog. Prices are entered in Pakistani rupees.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Product details</CardTitle>
            <CardDescription>
              Name and units per pack are required. Medicine details and prices are optional.
            </CardDescription>
          </CardHeader>
          <CardContent>
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

                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  <form.Field
                    name="category"
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
                            <SelectTrigger
                              aria-invalid={invalid}
                              className="w-full"
                              id={field.name}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectItem value="general">General</SelectItem>
                                <SelectItem value="medicine">Medicine</SelectItem>
                                <SelectItem value="cosmetics">Cosmetics</SelectItem>
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
                          <Input
                            aria-invalid={invalid}
                            id={field.name}
                            name={field.name}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            placeholder="e.g. 500mg"
                            value={field.state.value}
                          />
                          {invalid && <FieldError errors={field.state.meta.errors} />}
                        </Field>
                      );
                    }}
                  />
                </FieldGroup>

                <form.Field
                  name="unitsPerPack"
                  children={(field) => {
                    const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={field.name}>Units per pack</FieldLabel>
                        <Input
                          aria-invalid={invalid}
                          className="max-w-40"
                          id={field.name}
                          min="1"
                          name={field.name}
                          onBlur={field.handleBlur}
                          onChange={(event) => field.handleChange(event.target.value)}
                          step="1"
                          type="number"
                          value={field.state.value}
                        />
                        <FieldDescription>Use 1 when the item is sold as-is.</FieldDescription>
                        {invalid && <FieldError errors={field.state.meta.errors} />}
                      </Field>
                    );
                  }}
                />

                <FieldGroup className="grid gap-4 sm:grid-cols-3">
                  {(["costPrice", "packPrice", "unitPrice"] as const).map((name) => (
                    <form.Field
                      key={name}
                      name={name}
                      children={(field) => {
                        const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                        const labels = {
                          costPrice: "Cost price",
                          packPrice: "Pack price",
                          unitPrice: "Unit price",
                        } as const;
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel htmlFor={field.name}>{labels[name]}</FieldLabel>
                            <Input
                              aria-invalid={invalid}
                              id={field.name}
                              inputMode="decimal"
                              min="0"
                              name={field.name}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.target.value)}
                              placeholder="PKR 0.00"
                              step="0.01"
                              type="number"
                              value={field.state.value}
                            />
                            {invalid && <FieldError errors={field.state.meta.errors} />}
                          </Field>
                        );
                      }}
                    />
                  ))}
                </FieldGroup>
              </FieldGroup>
            </form>
          </CardContent>
          <CardFooter className="justify-end gap-2 border-t">
            <Link className={buttonVariants({ variant: "outline" })} to="/products">
              Cancel
            </Link>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
              {([canSubmit, isSubmitting]) => (
                <Button disabled={!canSubmit || isSubmitting} form="new-product-form" type="submit">
                  {isSubmitting && <Spinner data-icon="inline-start" />}
                  Create product
                </Button>
              )}
            </form.Subscribe>
          </CardFooter>
        </Card>

        <Alert>
          <AlertTitle>Stored locally first</AlertTitle>
          <AlertDescription>
            The product is available offline immediately and will be included in the next sync.
          </AlertDescription>
        </Alert>
      </div>
    </main>
  );
}
