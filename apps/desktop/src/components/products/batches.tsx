import { PackageIcon, PencilEdit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Batch, Product, StockMovement } from "@store/contracts";
import { productStock } from "@store/contracts/store-helpers";
import { useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { format, isValid, parse } from "date-fns";
import * as Schema from "effect/Schema";
import { useMemo, useState, type ReactNode } from "react";

import { ExpiryPicker } from "@/components/shared/expiry-picker";
import { FormField } from "@/components/shared/form-field";
import { FrameCard } from "@/components/shared/frame-card";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Fieldset } from "@/components/ui/fieldset";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toastManager } from "@/components/ui/toast";
import { toastStoreError } from "@/lib/errors";
import { formValidator } from "@/lib/form-schema";
import { EMPTY, formatCount, formatDate, formatNumber, parseExpiryDate } from "@/lib/format";
import { useInventoryActions } from "@/lib/inventory";
import { cn } from "@/lib/utils";

import { formatBatchQuantity, formatDelta, formatStock } from "./stock";

const ISO_DATE = "yyyy-MM-dd";

const parseISODate = (value: string): Date | undefined => {
  const parsed = parse(value, ISO_DATE, new Date());
  return isValid(parsed) ? parsed : undefined;
};

const formatISODate = (date: Date): string => format(date, ISO_DATE);

const expiryInputValue = (timestamp: number | null): string =>
  timestamp == null ? "" : formatISODate(new Date(timestamp));

const stockQuantity = Schema.String.check(
  Schema.makeFilter((value) =>
    value === "" || (Number.isInteger(Number(value)) && Number(value) >= 0)
      ? undefined
      : "Enter a non-negative whole number.",
  ),
);

type StockValues = {
  readonly batchNumber: string;
  readonly expiresAt: string;
  readonly packQuantity: string;
  readonly unitQuantity: string;
};

const NO_STOCK: StockValues = {
  batchNumber: "",
  expiresAt: "",
  packQuantity: "",
  unitQuantity: "",
};

const stockValuesOf = (batch: Batch): StockValues => ({
  batchNumber: batch.batchNumber ?? "",
  expiresAt: expiryInputValue(batch.expiresAt),
  packQuantity: String(batch.packQuantity),
  unitQuantity: String(batch.unitQuantity),
});

const PackBatch = Schema.Struct({
  batchNumber: Schema.Trim.check(Schema.isMaxLength(64)),
  expiresAt: Schema.String,
  packQuantity: stockQuantity,
  unitQuantity: stockQuantity,
});

const UnitStock = Schema.Struct({
  batchNumber: Schema.String,
  expiresAt: Schema.String,
  packQuantity: Schema.String,
  unitQuantity: stockQuantity,
});

const STOCK_VALIDATORS = {
  pack: {
    add: formValidator(
      PackBatch.check(
        Schema.makeFilter((value) =>
          Number(value.packQuantity || 0) + Number(value.unitQuantity || 0) >= 1
            ? undefined
            : { path: ["packQuantity"], issue: "Add at least one pack or loose unit." },
        ),
      ),
    ),
    edit: formValidator(PackBatch),
  },
  unit: {
    add: formValidator(
      UnitStock.check(
        Schema.makeFilter((value) =>
          Number(value.unitQuantity || 0) >= 1
            ? undefined
            : { path: ["unitQuantity"], issue: "Add at least one unit." },
        ),
      ),
    ),
    edit: formValidator(UnitStock),
  },
};

type StockEntry = {
  readonly batchNumber: string | null;
  readonly expiresAt: number | null;
  readonly packQuantity: number;
  readonly unitQuantity: number;
};

const stockEntryOf = (value: StockValues): StockEntry => ({
  batchNumber: value.batchNumber.trim() || null,
  expiresAt: parseExpiryDate(value.expiresAt),
  packQuantity: Number(value.packQuantity || 0),
  unitQuantity: Number(value.unitQuantity || 0),
});

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
  const [year] = useState(() => new Date().getFullYear());
  return (
    <FormField
      description="Month and year, or pick an exact day."
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
          startMonth={new Date(year - 1, 0)}
          endMonth={new Date(year + 15, 11)}
        />
      )}
    </FormField>
  );
}

function QuantityField({
  autoFocus,
  field,
  label,
}: {
  autoFocus?: boolean;
  field: BatchTextField;
  label: string;
}) {
  return (
    <FormField field={field} label={label}>
      {(control) => (
        <Input
          {...control}
          autoFocus={autoFocus}
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

function StockSheet({
  description,
  failure,
  formId,
  initial,
  intent,
  onOpenChange,
  onSave,
  open,
  submitLabel,
  title,
  tracksPacks,
  trigger,
}: {
  description: string;
  failure: string;
  formId: string;
  initial: StockValues;
  intent: "add" | "edit";
  onOpenChange: (open: boolean) => void;
  onSave: (stock: StockEntry) => Promise<void>;
  open: boolean;
  submitLabel: string;
  title: string;
  tracksPacks: boolean;
  trigger?: ReactNode;
}) {
  const form = useForm({
    defaultValues: initial,
    validators: { onSubmit: STOCK_VALIDATORS[tracksPacks ? "pack" : "unit"][intent] },
    onSubmit: async ({ value }) => {
      try {
        await onSave(stockEntryOf(value));
        onOpenChange(false);
        if (intent === "add") form.reset();
      } catch (error) {
        toastStoreError(error, failure);
      }
    },
  });

  return (
    <form.Subscribe selector={(state) => state.canSubmit}>
      {(canSubmit) => (
        <Sheet
          open={open}
          onOpenChange={(next) => {
            if (!next) form.reset(initial);
            onOpenChange(next);
          }}
        >
          {trigger}
          <SheetPopup showCloseButton={false} variant="inset">
            <SheetHeader>
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription>{description}</SheetDescription>
            </SheetHeader>
            <SheetPanel>
              <form
                id={formId}
                onSubmit={(event) => {
                  event.preventDefault();
                  void form.handleSubmit();
                }}
              >
                <Fieldset className="w-full">
                  {tracksPacks ? (
                    <div className="flex flex-col gap-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <form.Field
                          name="batchNumber"
                          children={(field) => <BatchNumberField field={field} />}
                        />
                        <form.Field
                          name="expiresAt"
                          children={(field) => <BatchExpiryField field={field} />}
                        />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <form.Field
                          name="packQuantity"
                          children={(field) => <QuantityField field={field} label="Sealed packs" />}
                        />
                        <form.Field
                          name="unitQuantity"
                          children={(field) => <QuantityField field={field} label="Loose units" />}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <form.Field
                        name="unitQuantity"
                        children={(field) => (
                          <QuantityField autoFocus field={field} label="Quantity" />
                        )}
                      />
                      <form.Field
                        name="expiresAt"
                        children={(field) => <BatchExpiryField field={field} />}
                      />
                    </div>
                  )}
                </Fieldset>
              </form>
            </SheetPanel>
            <SheetFooter>
              <SheetClose render={<Button variant="ghost" />}>Cancel</SheetClose>
              <Button disabled={!canSubmit} form={formId} type="submit">
                {submitLabel}
              </Button>
            </SheetFooter>
          </SheetPopup>
        </Sheet>
      )}
    </form.Subscribe>
  );
}

export function AddStockSheet({
  onOpenChange,
  open,
  product,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  product: Product;
}) {
  const { createBatch } = useInventoryActions();
  const tracksPacks = product.category.tracksPacks;
  return (
    <StockSheet
      description={
        tracksPacks
          ? "Record sealed packs and loose units separately for this batch."
          : "How many arrived, and when they expire."
      }
      failure="Could not add the batch."
      formId="add-batch-form"
      initial={NO_STOCK}
      intent="add"
      key={tracksPacks ? "pack" : "unit"}
      onOpenChange={onOpenChange}
      onSave={async (stock) => {
        await createBatch({ productId: product.id, ...stock });
        toastManager.add({ title: tracksPacks ? "Batch added" : "Stock added", type: "success" });
      }}
      open={open}
      submitLabel="Add stock"
      title="Add stock"
      tracksPacks={tracksPacks}
    />
  );
}

function EditStockSheet({ batch, tracksPacks }: { batch: Batch; tracksPacks: boolean }) {
  const { updateBatch } = useInventoryActions();
  const [open, setOpen] = useState(false);
  const title = tracksPacks ? "Edit batch" : "Edit stock";
  return (
    <StockSheet
      description={
        tracksPacks
          ? "Correct the batch number, expiry date or counts. A changed count is recorded as a stock adjustment."
          : "Correct the expiry date or the quantity. A changed count is recorded as a stock adjustment."
      }
      failure="Could not update the batch."
      formId={`edit-batch-form-${batch.id}`}
      initial={stockValuesOf(batch)}
      intent="edit"
      onOpenChange={setOpen}
      onSave={async (stock) => {
        await updateBatch(
          tracksPacks
            ? { id: batch.id, ...stock }
            : {
                id: batch.id,
                ...stock,
                batchNumber: batch.batchNumber,
                packQuantity: batch.packQuantity,
              },
        );
        toastManager.add({
          title: tracksPacks ? "Batch updated" : "Stock updated",
          type: "success",
        });
      }}
      open={open}
      submitLabel="Save changes"
      title={title}
      tracksPacks={tracksPacks}
      trigger={
        <SheetTrigger render={<Button aria-label={title} size="icon-sm" variant="ghost" />}>
          <HugeiconsIcon aria-hidden="true" icon={PencilEdit02Icon} />
        </SheetTrigger>
      }
    />
  );
}

const muted = <span className="text-muted-foreground">{EMPTY}</span>;

function ExpiryCell({ expiresAt, now }: { expiresAt: number | null; now: number }) {
  if (expiresAt === null) return muted;
  const expired = expiresAt < now;
  return (
    <span className={expired ? "text-destructive-foreground" : undefined}>
      {formatDate(expiresAt)}
      {expired ? " · Expired" : ""}
    </span>
  );
}

function BatchRow({
  batch,
  now,
  tracksPacks,
}: {
  batch: Batch;
  now: number;
  tracksPacks: boolean;
}) {
  const empty = batch.packQuantity + batch.unitQuantity === 0;
  return (
    <TableRow>
      {tracksPacks ? (
        <TableCell>
          <span className="font-medium">{batch.batchNumber ?? muted}</span>
        </TableCell>
      ) : null}
      <TableCell>
        <ExpiryCell expiresAt={batch.expiresAt} now={now} />
      </TableCell>
      <TableCell>
        <div className={cn("text-end tabular-nums", empty && "text-muted-foreground")}>
          {formatBatchQuantity(batch.packQuantity, batch.unitQuantity, tracksPacks)}
        </div>
      </TableCell>
      <TableCell>
        <div className="text-end text-muted-foreground tabular-nums">
          {formatDate(batch.createdAt)}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex justify-end">
          <EditStockSheet
            batch={batch}
            key={tracksPacks ? "pack" : "unit"}
            tracksPacks={tracksPacks}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

function EndHead({ children }: { children: ReactNode }) {
  return (
    <TableHead>
      <div className="text-end">{children}</div>
    </TableHead>
  );
}

export function ProductBatchesCard({ product }: { product: Product }) {
  const tracksPacks = product.category.tracksPacks;
  const [now] = useState(() => Date.now());
  const stock = formatStock(productStock(product), product.unitsPerPack, tracksPacks);

  return (
    <FrameCard
      description={`${stock} on hand · ${formatCount(product.batches.length, "batch", "batches")}`}
      table={product.batches.length > 0}
      title="Stock batches"
    >
      {product.batches.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon aria-hidden="true" icon={PackageIcon} />
            </EmptyMedia>
            <EmptyTitle>Nothing in stock yet</EmptyTitle>
            <EmptyDescription>
              Press <Kbd>A</Kbd> to add stock. Sales draw from the earliest expiry first.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table variant="card">
          <TableHeader>
            <TableRow>
              {tracksPacks ? <TableHead>Batch</TableHead> : null}
              <TableHead>Expiry</TableHead>
              <EndHead>Quantity</EndHead>
              <EndHead>Added</EndHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {product.batches.map((batch) => (
              <BatchRow batch={batch} key={batch.id} now={now} tracksPacks={tracksPacks} />
            ))}
          </TableBody>
        </Table>
      )}
    </FrameCard>
  );
}

const MOVEMENT_LABEL = {
  stock_in: "Received",
  sale: "Sold",
  open_pack: "Opened pack",
  adjustment: "Adjusted",
} satisfies Record<StockMovement["type"], string>;

const MOVEMENT_PREVIEW = 10;

function MovementReference({
  batchNumbers,
  movement,
}: {
  batchNumbers: ReadonlyMap<string, string | null>;
  movement: StockMovement;
}) {
  if (movement.invoiceId !== null) {
    return (
      <Link
        className="hover:underline"
        params={{ invoiceId: movement.invoiceId }}
        to="/invoices/$invoiceId"
      >
        Invoice
      </Link>
    );
  }
  if (movement.note) return <span className="truncate leading-tight">{movement.note}</span>;
  const batchNumber = batchNumbers.get(movement.batchId);
  return batchNumber ? <span>Batch {batchNumber}</span> : muted;
}

export function ProductStockMovementsCard({
  product,
  movements,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  product: Product;
  movements: readonly StockMovement[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const batchNumbers = useMemo(
    () => new Map(product.batches.map((batch) => [batch.id, batch.batchNumber])),
    [product.batches],
  );
  const shown = expanded ? movements : movements.slice(0, MOVEMENT_PREVIEW);

  return (
    <FrameCard
      action={
        movements.length > MOVEMENT_PREVIEW || hasMore ? (
          <Button onClick={() => setExpanded(!expanded)} size="xs" variant="ghost">
            {expanded
              ? "Show less"
              : hasMore
                ? "Show more"
                : `Show all ${formatNumber(movements.length)}`}
          </Button>
        ) : undefined
      }
      table={movements.length > 0}
      title="Recent movements"
    >
      {movements.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No movements yet</EmptyTitle>
            <EmptyDescription>Receipts and sales show up here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table variant="card">
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <EndHead>Quantity</EndHead>
              <TableHead>Reference</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((movement) => {
              const net = movement.packDelta * product.unitsPerPack + movement.unitDelta;
              return (
                <TableRow key={movement.id}>
                  <TableCell>
                    <span className="text-muted-foreground tabular-nums">
                      {formatDate(movement.createdAt)}
                    </span>
                  </TableCell>
                  <TableCell>{MOVEMENT_LABEL[movement.type]}</TableCell>
                  <TableCell>
                    <div
                      className={cn(
                        "text-end tabular-nums",
                        net > 0 && "text-success-foreground",
                        net === 0 && "text-muted-foreground",
                      )}
                    >
                      {formatDelta(movement.packDelta, movement.unitDelta)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <MovementReference batchNumbers={batchNumbers} movement={movement} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {expanded && hasMore && (
        <div className="flex justify-center border-t p-2">
          <Button loading={loadingMore} onClick={onLoadMore} size="xs" variant="ghost">
            Load older movements
          </Button>
        </div>
      )}
    </FrameCard>
  );
}
