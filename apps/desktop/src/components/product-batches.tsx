import { useState } from "react";
import type { Product, StockMovement } from "@store/contracts";
import { productLooseUnitStock, productPackStock, productStock } from "@store/contracts";
import { Add01Icon, PackageIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import * as z from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { formatDate, formatDateTime } from "@/lib/format";

const stockQuantity = z
  .string()
  .refine((value) => value === "" || (Number.isInteger(Number(value)) && Number(value) >= 0), {
    message: "Enter a non-negative whole number.",
  });

const batchFormSchema = z
  .object({
    batchNumber: z.string().trim().max(64),
    expiresAt: z.string(),
    packQuantity: stockQuantity,
    unitQuantity: stockQuantity,
  })
  .refine((value) => Number(value.packQuantity || 0) + Number(value.unitQuantity || 0) >= 1, {
    message: "Add at least one pack or loose unit.",
    path: ["packQuantity"],
  });

function AddBatchDialog({ productId }: { productId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm({
    defaultValues: {
      batchNumber: "",
      expiresAt: "",
      packQuantity: "",
      unitQuantity: "",
    },
    validators: { onSubmit: batchFormSchema },
    onSubmit: async ({ value }) => {
      try {
        await window.offlineStore.createBatch({
          productId,
          batchNumber: value.batchNumber.trim() || null,
          expiresAt: value.expiresAt ? Date.parse(value.expiresAt) : null,
          packQuantity: Number(value.packQuantity || 0),
          unitQuantity: Number(value.unitQuantity || 0),
        });
        toast.success("Batch added");
        setOpen(false);
        form.reset();
        await router.invalidate();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not add the batch.");
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
        Add batch
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add batch</DialogTitle>
          <DialogDescription>
            Record sealed packs and loose units separately for this batch.
          </DialogDescription>
        </DialogHeader>
        <form
          id="add-batch-form"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <form.Field
                name="batchNumber"
                children={(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={field.name}>Batch number</FieldLabel>
                      <Input
                        aria-invalid={invalid}
                        autoFocus
                        id={field.name}
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
                name="expiresAt"
                children={(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={field.name}>Expiry date</FieldLabel>
                      <Input
                        aria-invalid={invalid}
                        id={field.name}
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        type="date"
                        value={field.state.value}
                      />
                      {invalid && <FieldError errors={field.state.meta.errors} />}
                    </Field>
                  );
                }}
              />
            </FieldGroup>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              {(["packQuantity", "unitQuantity"] as const).map((name) => (
                <form.Field
                  key={name}
                  name={name}
                  children={(field) => {
                    const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={field.name}>
                          {name === "packQuantity" ? "Sealed packs" : "Loose units"}
                        </FieldLabel>
                        <Input
                          aria-invalid={invalid}
                          id={field.name}
                          min="0"
                          name={field.name}
                          onBlur={field.handleBlur}
                          onChange={(event) => field.handleChange(event.target.value)}
                          step="1"
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
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
              <Button disabled={!canSubmit || isSubmitting} form="add-batch-form" type="submit">
                {isSubmitting && <Spinner data-icon="inline-start" />}
                Add batch
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProductBatchesCard({ product }: { product: Product }) {
  const stock = productStock(product);
  const packs = productPackStock(product);
  const looseUnits = productLooseUnitStock(product);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Batches
          <Badge className="ml-2" variant="secondary">
            {packs} packs · {looseUnits} loose · {stock} total units
          </Badge>
        </CardTitle>
        <CardAction>
          <AddBatchDialog productId={product.id} />
        </CardAction>
      </CardHeader>
      <CardContent>
        {product.batches.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon aria-hidden="true" icon={PackageIcon} />
              </EmptyMedia>
              <EmptyTitle>No batches yet</EmptyTitle>
              <EmptyDescription>
                Add a batch to put this product in stock — sales draw from batches.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-2">
            {product.batches.map((batch) => (
              <Item key={batch.id} variant="outline">
                <ItemContent>
                  <ItemTitle>{batch.batchNumber ?? "Unnumbered batch"}</ItemTitle>
                  <ItemDescription>
                    {batch.expiresAt ? `Expires ${formatDate(batch.expiresAt)}` : "No expiry date"}
                    {" · "}added {formatDate(batch.createdAt)}
                  </ItemDescription>
                </ItemContent>
                <Badge
                  variant={batch.packQuantity + batch.unitQuantity === 0 ? "outline" : "secondary"}
                >
                  {batch.packQuantity + batch.unitQuantity === 0
                    ? "Empty"
                    : `${batch.packQuantity} packs · ${batch.unitQuantity} loose`}
                </Badge>
              </Item>
            ))}
          </ItemGroup>
        )}
      </CardContent>
    </Card>
  );
}

const movementLabel = (movement: StockMovement) => {
  switch (movement.type) {
    case "stock_in":
      return "Stock received";
    case "sale":
      return "Sale";
    case "open_pack":
      return "Pack opened";
    case "adjustment":
      return "Adjustment";
  }
};

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

export function ProductStockMovementsCard({ movements }: { movements: readonly StockMovement[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock movements</CardTitle>
      </CardHeader>
      <CardContent>
        {movements.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon aria-hidden="true" icon={PackageIcon} />
              </EmptyMedia>
              <EmptyTitle>No movements yet</EmptyTitle>
              <EmptyDescription>Stock receipts and sales will appear here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-2">
            {movements.map((movement) => (
              <Item key={movement.id} variant="outline">
                <ItemContent>
                  <ItemTitle>{movementLabel(movement)}</ItemTitle>
                  <ItemDescription>
                    {movement.note ?? "Inventory updated"} · {formatDateTime(movement.createdAt)}
                  </ItemDescription>
                </ItemContent>
                <Badge variant="secondary">
                  {signed(movement.packDelta)} packs · {signed(movement.unitDelta)} units
                </Badge>
              </Item>
            ))}
          </ItemGroup>
        )}
      </CardContent>
    </Card>
  );
}
