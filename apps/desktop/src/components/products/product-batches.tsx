import { FrameCard } from "@/components/frame-card";
import { useMemo, useState } from "react";
import type { Product, StockMovement } from "@store/contracts";
import {
  productLooseUnitStock,
  productPackStock,
  productStock,
} from "@store/contracts/store-helpers";
import { Add01Icon, PackageIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, Cell, XAxis } from "recharts";
import * as z from "zod";
import { DatePicker } from "@/components/date-picker";
import { Button } from "@/components/ui/button";
import { Frame, FrameHeader } from "@/components/ui/frame";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { FormFieldError } from "@/components/form-field-error";
import { Field, FieldLabel } from "@/components/ui/field";
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
import { Fieldset } from "@/components/ui/fieldset";
import { Input } from "@/components/ui/input";
import { toastManager } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";

const parseISODate = (value: string): Date | undefined => {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
};

const formatISODate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

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
        toastManager.add({ title: "Batch added", type: "success" });
        setOpen(false);
        form.reset();
        await router.invalidate();
      } catch (error) {
        toastManager.add({
          title: error instanceof Error ? error.message : "Could not add the batch.",
          type: "error",
        });
      }
    },
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button size="sm" variant="outline" />}>
        <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
        Add batch
      </SheetTrigger>
      <SheetPopup variant="inset">
        <SheetHeader>
          <SheetTitle>Add batch</SheetTitle>
          <SheetDescription>
            Record sealed packs and loose units separately for this batch.
          </SheetDescription>
        </SheetHeader>
        <SheetPanel>
          <form
            id="add-batch-form"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <Fieldset className="flex w-full flex-col gap-6">
              <Fieldset className="grid gap-4">
                <form.Field
                  name="batchNumber"
                  children={(field) => {
                    const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={field.name}>Batch number</FieldLabel>
                        <Input
                          aria-invalid={invalid || undefined}
                          autoFocus
                          id={field.name}
                          name={field.name}
                          onBlur={field.handleBlur}
                          onChange={(event) => field.handleChange(event.target.value)}
                          placeholder="Optional"
                          value={field.state.value}
                        />
                        {invalid && <FormFieldError errors={field.state.meta.errors} />}
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
                        <DatePicker
                          id={field.name}
                          value={field.state.value ? parseISODate(field.state.value) : undefined}
                          onChange={(date) => field.handleChange(date ? formatISODate(date) : "")}
                          onBlur={field.handleBlur}
                          placeholder="No expiry"
                          startMonth={new Date(new Date().getFullYear() - 1, 0)}
                          endMonth={new Date(new Date().getFullYear() + 15, 11)}
                        />
                        {invalid && <FormFieldError errors={field.state.meta.errors} />}
                      </Field>
                    );
                  }}
                />
              </Fieldset>
              <Fieldset className="grid gap-4">
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
                            aria-invalid={invalid || undefined}
                            id={field.name}
                            min="0"
                            name={field.name}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            step="1"
                            type="number"
                            value={field.state.value}
                          />
                          {invalid && <FormFieldError errors={field.state.meta.errors} />}
                        </Field>
                      );
                    }}
                  />
                ))}
              </Fieldset>
            </Fieldset>
          </form>
        </SheetPanel>
        <SheetFooter>
          <SheetClose render={<Button variant="ghost" />}>Cancel</SheetClose>
          <form.Subscribe selector={(state) => state.canSubmit}>
            {(canSubmit) => (
              <Button disabled={!canSubmit} form="add-batch-form" type="submit">
                Add batch
              </Button>
            )}
          </form.Subscribe>
        </SheetFooter>
      </SheetPopup>
    </Sheet>
  );
}

export function ProductBatchesCard({ product }: { product: Product }) {
  const stock = productStock(product);
  const packs = productPackStock(product);
  const looseUnits = productLooseUnitStock(product);

  return (
    <FrameCard
      action={<AddBatchDialog productId={product.id} />}
      description={`${packs} packs · ${looseUnits} loose · ${stock} total units`}
      title="Batches"
    >
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
        <div className="flex flex-col gap-2">
          {product.batches.map((batch) => (
            <Frame className="w-full" key={batch.id}>
              <FrameHeader className="flex-row items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{batch.batchNumber ?? "Unnumbered batch"}</p>
                  <p className="truncate text-muted-foreground text-xs">
                    {batch.expiresAt ? `Expires ${formatDate(batch.expiresAt)}` : "No expiry date"}
                    {" · "}added {formatDate(batch.createdAt)}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums">
                  {batch.packQuantity + batch.unitQuantity === 0
                    ? "Empty"
                    : `${batch.packQuantity} packs · ${batch.unitQuantity} loose`}
                </span>
              </FrameHeader>
            </Frame>
          ))}
        </div>
      )}
    </FrameCard>
  );
}

const movementsChartConfig = {
  net: { label: "Net units" },
} satisfies ChartConfig;

const stockInColor = "var(--chart-2)";
const stockOutColor = "var(--chart-4)";

type DayTotal = { date: string; net: number };

const dayKey = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

const formatDayTick = (value: unknown) =>
  new Date(String(value)).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function stockMovementsByDay(
  movements: readonly StockMovement[],
  unitsPerPack: number,
): DayTotal[] {
  const totals = new Map<string, number>();
  for (const movement of movements) {
    const date = dayKey(movement.createdAt);
    const netUnits = movement.packDelta * unitsPerPack + movement.unitDelta;
    totals.set(date, (totals.get(date) ?? 0) + netUnits);
  }
  return Array.from(totals.entries())
    .map(([date, net]) => ({ date, net }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function ProductStockMovementsCard({
  product,
  movements,
}: {
  product: Product;
  movements: readonly StockMovement[];
}) {
  const data = useMemo(
    () => stockMovementsByDay(movements, product.unitsPerPack),
    [movements, product.unitsPerPack],
  );

  return (
    <FrameCard title="Stock movements">
      {data.length === 0 ? (
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
        <>
          <ChartContainer className="aspect-auto h-56 w-full" config={movementsChartConfig}>
            <BarChart data={data}>
              <CartesianGrid vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="date"
                tickFormatter={formatDayTick}
                tickLine={false}
                tickMargin={8}
              />
              <ChartTooltip
                content={<ChartTooltipContent labelFormatter={formatDayTick} />}
                cursor={false}
              />
              <Bar dataKey="net" radius={4}>
                {data.map((entry) => (
                  <Cell fill={entry.net >= 0 ? stockInColor : stockOutColor} key={entry.date} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
          <div className="mt-3 flex items-center justify-center gap-4 text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-xs" style={{ backgroundColor: stockInColor }} />
              Stock in
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-xs" style={{ backgroundColor: stockOutColor }} />
              Stock out
            </span>
          </div>
        </>
      )}
    </FrameCard>
  );
}
