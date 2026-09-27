import { Add01Icon, PackageIcon, PencilEdit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Batch, Product, StockMovement } from "@store/contracts";
import {
  productLooseUnitStock,
  productPackStock,
  productStock,
} from "@store/contracts/store-helpers";
import { barY, defineChart, type ChartPoint } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { useForm } from "@tanstack/react-form";
import * as Schema from "effect/Schema";
import { useMemo, useState, type ReactNode } from "react";

import { ExpiryPicker } from "@/components/shared/expiry-picker";
import { FormField } from "@/components/shared/form-field";
import { FrameCard } from "@/components/shared/frame-card";
import { Button } from "@/components/ui/button";
import {
  Chart,
  ChartContainer,
  CHART_HEIGHT,
  chartTheme,
  chartTooltip,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import { toastManager } from "@/components/ui/toast";
import { toastStoreError } from "@/lib/errors";
import { formValidator } from "@/lib/form-schema";
import { formatDate } from "@/lib/format";
import { useInventoryActions } from "@/lib/inventory-db";

const parseISODate = (value: string): Date | undefined => {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
};

const formatISODate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

// Expiries are stored as local midnight, matching `parseExpiryDate` on the
// import path, so a date written here reads back as the same calendar day.
const expiryTimestamp = (value: string): number | null =>
  value ? (parseISODate(value)?.getTime() ?? null) : null;

const expiryInputValue = (timestamp: number | null): string =>
  timestamp == null ? "" : formatISODate(new Date(timestamp));

const stockQuantity = Schema.String.check(
  Schema.makeFilter((value) =>
    value === "" || (Number.isInteger(Number(value)) && Number(value) >= 0)
      ? undefined
      : "Enter a non-negative whole number.",
  ),
);

const BatchDetails = {
  batchNumber: Schema.Trim.check(Schema.isMaxLength(64)),
  expiresAt: Schema.String,
};

const packBatchCreateSchema = formValidator(
  Schema.Struct({
    ...BatchDetails,
    packQuantity: stockQuantity,
    unitQuantity: stockQuantity,
  }).check(
    Schema.makeFilter((value) =>
      Number(value.packQuantity || 0) + Number(value.unitQuantity || 0) >= 1
        ? undefined
        : { path: ["packQuantity"], issue: "Add at least one pack or loose unit." },
    ),
  ),
);

const unitStockCreateSchema = formValidator(
  Schema.Struct({
    expiresAt: Schema.String,
    unitQuantity: stockQuantity,
  }).check(
    Schema.makeFilter((value) =>
      Number(value.unitQuantity || 0) >= 1
        ? undefined
        : { path: ["unitQuantity"], issue: "Add at least one unit." },
    ),
  ),
);

// Editing may empty a batch. A miscount corrected to zero is a real state,
// unlike creating one with nothing in it.
const packBatchEditSchema = formValidator(
  Schema.Struct({
    ...BatchDetails,
    packQuantity: stockQuantity,
    unitQuantity: stockQuantity,
  }),
);

const unitStockEditSchema = formValidator(
  Schema.Struct({
    expiresAt: Schema.String,
    unitQuantity: stockQuantity,
  }),
);

// Structural shape of a TanStack Form string field, so the fields both
// batch forms share stay decoupled from each form's generics.
interface BatchTextField {
  readonly name: string;
  readonly state: {
    readonly value: string;
    readonly meta: {
      readonly isTouched: boolean;
      readonly isValid: boolean;
      readonly errors: ReadonlyArray<unknown>;
    };
  };
  readonly handleBlur: () => void;
  readonly handleChange: (value: string) => void;
}

function BatchNumberField({ field }: { field: BatchTextField }) {
  return (
    <FormField field={field} label="Batch number">
      {(control) => (
        <Input
          {...control}
          autoFocus
          onBlur={field.handleBlur}
          onChange={(event) => field.handleChange(event.target.value)}
          placeholder="Optional"
          value={field.state.value}
        />
      )}
    </FormField>
  );
}

function BatchExpiryField({ field }: { field: BatchTextField }) {
  return (
    <FormField
      description="Month and year. The calendar is there for an exact day."
      field={field}
      label="Expiry date"
    >
      {(control, invalid) => (
        <ExpiryPicker
          id={control.id}
          name={control.name}
          invalid={invalid}
          value={field.state.value ? parseISODate(field.state.value) : undefined}
          onChange={(date) => field.handleChange(date ? formatISODate(date) : "")}
          onBlur={field.handleBlur}
          startMonth={new Date(new Date().getFullYear() - 1, 0)}
          endMonth={new Date(new Date().getFullYear() + 15, 11)}
        />
      )}
    </FormField>
  );
}

function QuantityField({ field, label }: { field: BatchTextField; label: string }) {
  return (
    <FormField field={field} label={label}>
      {(control) => (
        <Input
          {...control}
          min="0"
          onBlur={field.handleBlur}
          onChange={(event) => field.handleChange(event.target.value)}
          step="1"
          type="number"
          value={field.state.value}
        />
      )}
    </FormField>
  );
}

function BatchSheet({
  canSubmit,
  description,
  formId,
  onOpenChange,
  open,
  submitLabel,
  title,
  trigger,
  children,
}: {
  canSubmit: boolean;
  children: ReactNode;
  description: string;
  formId: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  submitLabel: string;
  title: string;
  trigger: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {trigger}
      <SheetPopup variant="inset">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <SheetPanel>{children}</SheetPanel>
        <SheetFooter>
          <SheetClose render={<Button variant="ghost" />}>Cancel</SheetClose>
          <Button disabled={!canSubmit} form={formId} type="submit">
            {submitLabel}
          </Button>
        </SheetFooter>
      </SheetPopup>
    </Sheet>
  );
}

function AddPackBatchDialog({ productId }: { productId: string }) {
  const { createBatch } = useInventoryActions();
  const [open, setOpen] = useState(false);
  const form = useForm({
    defaultValues: {
      batchNumber: "",
      expiresAt: "",
      packQuantity: "",
      unitQuantity: "",
    },
    validators: { onSubmit: packBatchCreateSchema },
    onSubmit: async ({ value }) => {
      try {
        await createBatch({
          productId,
          batchNumber: value.batchNumber.trim() || null,
          expiresAt: expiryTimestamp(value.expiresAt),
          packQuantity: Number(value.packQuantity || 0),
          unitQuantity: Number(value.unitQuantity || 0),
        });
        toastManager.add({ title: "Batch added", type: "success" });
        setOpen(false);
        form.reset();
      } catch (error) {
        toastStoreError(error, "Could not add the batch.");
      }
    },
  });

  return (
    <form.Subscribe selector={(state) => state.canSubmit}>
      {(canSubmit) => (
        <BatchSheet
          canSubmit={canSubmit}
          description="Record sealed packs and loose units separately for this batch."
          formId="add-batch-form"
          onOpenChange={setOpen}
          open={open}
          submitLabel="Add batch"
          title="Add batch"
          trigger={
            <SheetTrigger render={<Button size="sm" variant="outline" />}>
              <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
              Add batch
            </SheetTrigger>
          }
        >
          <form
            id="add-batch-form"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <Fieldset className="flex w-full flex-col">
              <Fieldset className="grid">
                <form.Field
                  name="batchNumber"
                  children={(field) => <BatchNumberField field={field} />}
                />
                <form.Field
                  name="expiresAt"
                  children={(field) => <BatchExpiryField field={field} />}
                />
              </Fieldset>
              <Fieldset className="grid">
                <form.Field
                  name="packQuantity"
                  children={(field) => <QuantityField field={field} label="Sealed packs" />}
                />
                <form.Field
                  name="unitQuantity"
                  children={(field) => <QuantityField field={field} label="Loose units" />}
                />
              </Fieldset>
            </Fieldset>
          </form>
        </BatchSheet>
      )}
    </form.Subscribe>
  );
}

function AddUnitStockDialog({ productId }: { productId: string }) {
  const { createBatch } = useInventoryActions();
  const [open, setOpen] = useState(false);
  const form = useForm({
    defaultValues: {
      expiresAt: "",
      unitQuantity: "",
    },
    validators: { onSubmit: unitStockCreateSchema },
    onSubmit: async ({ value }) => {
      try {
        await createBatch({
          productId,
          batchNumber: null,
          expiresAt: expiryTimestamp(value.expiresAt),
          packQuantity: 0,
          unitQuantity: Number(value.unitQuantity || 0),
        });
        toastManager.add({ title: "Stock added", type: "success" });
        setOpen(false);
        form.reset();
      } catch (error) {
        toastStoreError(error, "Could not add the batch.");
      }
    },
  });

  return (
    <form.Subscribe selector={(state) => state.canSubmit}>
      {(canSubmit) => (
        <BatchSheet
          canSubmit={canSubmit}
          description="How many arrived, and when they expire."
          formId="add-batch-form"
          onOpenChange={setOpen}
          open={open}
          submitLabel="Add stock"
          title="Add stock"
          trigger={
            <SheetTrigger render={<Button size="sm" variant="outline" />}>
              <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
              Add stock
            </SheetTrigger>
          }
        >
          <form
            id="add-batch-form"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <Fieldset className="flex w-full flex-col">
              <Fieldset className="grid">
                <form.Field
                  name="expiresAt"
                  children={(field) => <BatchExpiryField field={field} />}
                />
              </Fieldset>
              <Fieldset className="grid">
                <form.Field
                  name="unitQuantity"
                  children={(field) => <QuantityField field={field} label="Quantity" />}
                />
              </Fieldset>
            </Fieldset>
          </form>
        </BatchSheet>
      )}
    </form.Subscribe>
  );
}

const packBatchToFormValues = (batch: Batch) => ({
  batchNumber: batch.batchNumber ?? "",
  expiresAt: expiryInputValue(batch.expiresAt),
  packQuantity: String(batch.packQuantity),
  unitQuantity: String(batch.unitQuantity),
});

const unitStockToFormValues = (batch: Batch) => ({
  expiresAt: expiryInputValue(batch.expiresAt),
  unitQuantity: String(batch.unitQuantity),
});

function EditPackBatchDialog({ batch }: { batch: Batch }) {
  const { updateBatch } = useInventoryActions();
  const [open, setOpen] = useState(false);
  const formId = `edit-batch-form-${batch.id}`;
  const form = useForm({
    defaultValues: packBatchToFormValues(batch),
    validators: { onSubmit: packBatchEditSchema },
    onSubmit: async ({ value }) => {
      try {
        await updateBatch({
          id: batch.id,
          batchNumber: value.batchNumber.trim() || null,
          expiresAt: expiryTimestamp(value.expiresAt),
          packQuantity: Number(value.packQuantity || 0),
          unitQuantity: Number(value.unitQuantity || 0),
        });
        toastManager.add({ title: "Batch updated", type: "success" });
        setOpen(false);
      } catch (error) {
        toastStoreError(error, "Could not update the batch.");
      }
    },
  });

  return (
    <form.Subscribe selector={(state) => state.canSubmit}>
      {(canSubmit) => (
        <BatchSheet
          canSubmit={canSubmit}
          description="Correct the batch number, expiry date or counts. A changed count is recorded as a stock adjustment."
          formId={formId}
          onOpenChange={(next) => {
            if (!next) form.reset(packBatchToFormValues(batch));
            setOpen(next);
          }}
          open={open}
          submitLabel="Save changes"
          title="Edit batch"
          trigger={
            <SheetTrigger
              render={<Button aria-label="Edit batch" size="icon-sm" variant="ghost" />}
            >
              <HugeiconsIcon aria-hidden="true" icon={PencilEdit02Icon} />
            </SheetTrigger>
          }
        >
          <form
            id={formId}
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <Fieldset className="flex w-full flex-col">
              <Fieldset className="grid">
                <form.Field
                  name="batchNumber"
                  children={(field) => <BatchNumberField field={field} />}
                />
                <form.Field
                  name="expiresAt"
                  children={(field) => <BatchExpiryField field={field} />}
                />
              </Fieldset>
              <Fieldset className="grid">
                <form.Field
                  name="packQuantity"
                  children={(field) => <QuantityField field={field} label="Sealed packs" />}
                />
                <form.Field
                  name="unitQuantity"
                  children={(field) => <QuantityField field={field} label="Loose units" />}
                />
              </Fieldset>
            </Fieldset>
          </form>
        </BatchSheet>
      )}
    </form.Subscribe>
  );
}

function EditUnitStockDialog({ batch }: { batch: Batch }) {
  const { updateBatch } = useInventoryActions();
  const [open, setOpen] = useState(false);
  const formId = `edit-batch-form-${batch.id}`;
  const form = useForm({
    defaultValues: unitStockToFormValues(batch),
    validators: { onSubmit: unitStockEditSchema },
    onSubmit: async ({ value }) => {
      try {
        await updateBatch({
          id: batch.id,
          batchNumber: batch.batchNumber,
          expiresAt: expiryTimestamp(value.expiresAt),
          packQuantity: batch.packQuantity,
          unitQuantity: Number(value.unitQuantity || 0),
        });
        toastManager.add({ title: "Stock updated", type: "success" });
        setOpen(false);
      } catch (error) {
        toastStoreError(error, "Could not update the batch.");
      }
    },
  });

  return (
    <form.Subscribe selector={(state) => state.canSubmit}>
      {(canSubmit) => (
        <BatchSheet
          canSubmit={canSubmit}
          description="Correct the expiry date or the quantity. A changed count is recorded as a stock adjustment."
          formId={formId}
          onOpenChange={(next) => {
            if (!next) form.reset(unitStockToFormValues(batch));
            setOpen(next);
          }}
          open={open}
          submitLabel="Save changes"
          title="Edit stock"
          trigger={
            <SheetTrigger
              render={<Button aria-label="Edit stock" size="icon-sm" variant="ghost" />}
            >
              <HugeiconsIcon aria-hidden="true" icon={PencilEdit02Icon} />
            </SheetTrigger>
          }
        >
          <form
            id={formId}
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <Fieldset className="flex w-full flex-col">
              <Fieldset className="grid">
                <form.Field
                  name="expiresAt"
                  children={(field) => <BatchExpiryField field={field} />}
                />
              </Fieldset>
              <Fieldset className="grid">
                <form.Field
                  name="unitQuantity"
                  children={(field) => <QuantityField field={field} label="Quantity" />}
                />
              </Fieldset>
            </Fieldset>
          </form>
        </BatchSheet>
      )}
    </form.Subscribe>
  );
}

function PackBatchRow({ batch }: { batch: Batch }) {
  return (
    <Frame className="w-full">
      <FrameHeader className="flex-row items-center">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{batch.batchNumber ?? "Unnumbered batch"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {batch.expiresAt ? `Expires ${formatDate(batch.expiresAt)}` : "No expiry date"}
            {" · "}
            added {formatDate(batch.createdAt)}
          </p>
        </div>
        <span className="shrink-0 font-mono tabular-nums">
          {batch.packQuantity + batch.unitQuantity === 0
            ? "Empty"
            : `${batch.packQuantity} packs · ${batch.unitQuantity} loose`}
        </span>
        <EditPackBatchDialog batch={batch} />
      </FrameHeader>
    </Frame>
  );
}

function UnitStockRow({ batch }: { batch: Batch }) {
  return (
    <Frame className="w-full">
      <FrameHeader className="flex-row items-center">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {batch.expiresAt ? `Expires ${formatDate(batch.expiresAt)}` : "No expiry date"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            added {formatDate(batch.createdAt)}
          </p>
        </div>
        <span className="shrink-0 font-mono tabular-nums">
          {batch.packQuantity + batch.unitQuantity === 0 ? "Empty" : `${batch.unitQuantity}`}
        </span>
        <EditUnitStockDialog batch={batch} />
      </FrameHeader>
    </Frame>
  );
}

function PackBatchesCard({ product }: { product: Product }) {
  const stock = productStock(product);
  const packs = productPackStock(product);
  const looseUnits = productLooseUnitStock(product);

  return (
    <FrameCard
      action={<AddPackBatchDialog productId={product.id} />}
      description={`${packs} packs · ${looseUnits} loose · ${stock} total units`}
      title="Batches"
    >
      {product.batches.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon aria-hidden="true" icon={PackageIcon} />
            </EmptyMedia>
            <EmptyTitle>No batches yet</EmptyTitle>
            <EmptyDescription>
              Add a batch to put this product in stock. Sales draw from batches.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {product.batches.map((batch) => (
            <PackBatchRow batch={batch} key={batch.id} />
          ))}
        </div>
      )}
    </FrameCard>
  );
}

function UnitStockCard({ product }: { product: Product }) {
  const stock = productStock(product);

  return (
    <FrameCard
      action={<AddUnitStockDialog productId={product.id} />}
      description={`${stock} in stock`}
      title="Stock"
    >
      {product.batches.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon aria-hidden="true" icon={PackageIcon} />
            </EmptyMedia>
            <EmptyTitle>Nothing in stock yet</EmptyTitle>
            <EmptyDescription>Add stock to start selling this product.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {product.batches.map((batch) => (
            <UnitStockRow batch={batch} key={batch.id} />
          ))}
        </div>
      )}
    </FrameCard>
  );
}

export function ProductBatchesCard({ product }: { product: Product }) {
  // Stock still lives in batches for a single-unit product. That is what
  // expiry-first allocation draws from. Nothing about batches is shown.
  return product.category.tracksPacks ? (
    <PackBatchesCard product={product} />
  ) : (
    <UnitStockCard product={product} />
  );
}

const stockInColor = "var(--chart-2)";
const stockOutColor = "var(--chart-4)";

type DayTotal = { date: string; net: number };

const dayKey = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

const dayTick = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const formatDayTick = (value: string) => dayTick.format(new Date(value));

const movementsTooltip = (points: readonly ChartPoint<DayTotal>[]) => {
  const point = points[0];
  if (!point) return { rows: [] };
  return {
    title: formatDayTick(String(point.xValue ?? "")),
    rows: [
      {
        color: point.color,
        label: point.datum.net >= 0 ? "Stock in" : "Stock out",
        value: String(point.yValue ?? 0),
      },
    ],
  };
};

export function createStockMovementsChart(rows: readonly DayTotal[]) {
  return defineChart(
    {
      marks: [
        barY(rows, {
          id: "movement-bars",
          x: "date",
          y: "net",
          key: "date",
          fill: (row) => (row.net >= 0 ? stockInColor : stockOutColor),
          radius: 4,
        }),
      ],
      scales: {
        x: {
          scale: () => scaleBand<string>().paddingInner(0.2).paddingOuter(0.1),
          axis: {
            line: false,
            ticks: {
              size: 0,
              padding: 8,
              format: (value: string) => formatDayTick(value),
            },
            tickLabels: {
              thin: { minGap: 24, priority: "ends" },
            },
          },
        },
        y: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: false,
        },
      },
      theme: chartTheme,
    },
    {
      svgAnimation: false,
      focus: "group-x",
      tooltip: chartTooltip(movementsTooltip),
    },
  );
}

function StockMovementsChart({ data }: { data: readonly DayTotal[] }) {
  const definition = useMemo(() => createStockMovementsChart(data), [data]);

  return (
    <ChartContainer className="aspect-auto h-56 w-full">
      <Chart
        ariaLabel="Stock movements by day"
        className="w-full"
        definition={definition}
        height={CHART_HEIGHT}
      />
    </ChartContainer>
  );
}

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
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon aria-hidden="true" icon={PackageIcon} />
            </EmptyMedia>
            <EmptyTitle>No movements yet</EmptyTitle>
            <EmptyDescription>Receipts and sales show up here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <StockMovementsChart data={data} />
          <div className="mt-3 flex items-center justify-center gap-4 text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-xs bg-chart-2" />
              Stock in
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-xs bg-chart-4" />
              Stock out
            </span>
          </div>
        </>
      )}
    </FrameCard>
  );
}
