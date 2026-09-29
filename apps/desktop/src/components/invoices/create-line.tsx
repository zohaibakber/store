import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Batch } from "@store/contracts";
import { formatPrice } from "@store/services/format";
import { format } from "date-fns";
import type { KeyboardEvent } from "react";

import {
  AUTO_BATCH,
  lineTotal,
  paisaToRupees,
  suggestedPrice,
  useInvoiceCreate,
  type SaleLine,
} from "@/components/invoices/create-context";
import { Button } from "@/components/ui/button";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "@/components/ui/number-field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { EMPTY, pluralize } from "@/lib/format";

const quantityItems = [
  { label: "Unit", value: "unit" },
  { label: "Pack", value: "pack" },
] as const;

const batchStock = (line: SaleLine, batch: Batch) =>
  line.quantityUnit === "pack"
    ? batch.packQuantity
    : batch.packQuantity * line.product.unitsPerPack + batch.unitQuantity;

const batchLabel = (batch: Batch) => {
  const expiry = batch.expiresAt == null ? null : format(batch.expiresAt, "MMM ''yy");
  if (batch.batchNumber && expiry) return `${batch.batchNumber} · ${expiry}`;
  if (batch.batchNumber) return batch.batchNumber;
  return expiry ? `Exp ${expiry}` : EMPTY;
};

function LineBatch({ line }: { line: SaleLine }) {
  const {
    actions: { updateLine },
  } = useInvoiceCreate();
  const batches = line.product.batches.filter((batch) => batchStock(line, batch) > 0);
  const [only] = batches;

  if (batches.length <= 1) {
    return (
      <span className="block truncate text-xs leading-tight text-muted-foreground tabular-nums">
        {only ? batchLabel(only) : EMPTY}
      </span>
    );
  }

  const items: ReadonlyArray<{ label: string; value: SaleLine["batchId"] }> = [
    { label: "Auto", value: AUTO_BATCH },
    ...batches.map((batch) => ({ label: batchLabel(batch), value: batch.id })),
  ];

  return (
    <Select<SaleLine["batchId"]>
      items={items}
      onValueChange={(value) => {
        if (value) updateLine(line.key, { batchId: value });
      }}
      value={line.batchId}
    >
      <SelectTrigger aria-label="Batch" className="w-full min-w-0" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function InvoiceCreateLine({
  error,
  index,
  line,
}: {
  error: string | null;
  index: number;
  line: SaleLine;
}) {
  const {
    actions: { focusSearch, removeLine, setLineQuantityUnit, updateLine },
  } = useInvoiceCreate();

  const total = lineTotal(line);
  const suggested = paisaToRupees(suggestedPrice(line.product, line.quantityUnit));
  const priceChanged = line.salePrice != null && suggested != null && line.salePrice !== suggested;

  const remove = (row: HTMLTableRowElement) => {
    const sibling = row.nextElementSibling ?? row.previousElementSibling;
    removeLine(line.key);
    if (sibling instanceof HTMLElement && sibling.dataset.saleLine != null) sibling.focus();
    else focusSearch();
  };

  const returnOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    focusSearch();
  };

  return (
    <TableRow
      aria-invalid={error ? true : undefined}
      data-sale-line=""
      onKeyDown={(event) => {
        const onRow = event.target === event.currentTarget;
        const removeKey =
          (onRow && (event.key === "Delete" || event.key === "Backspace")) ||
          (event.key === "Backspace" && (event.ctrlKey || event.metaKey));
        if (!removeKey) return;
        event.preventDefault();
        remove(event.currentTarget);
      }}
      tabIndex={0}
    >
      <TableCell>
        <span className="block text-end text-xs text-muted-foreground tabular-nums">
          {index + 1}
        </span>
      </TableCell>
      <TableCell className="max-w-0">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="min-w-0 truncate leading-tight font-medium capitalize">
            {line.product.name}
          </span>
          {line.product.strength && (
            <span className="shrink-0 text-muted-foreground">{line.product.strength}</span>
          )}
          {error ? (
            <span
              className="min-w-0 flex-1 basis-0 truncate text-xs leading-tight text-destructive-foreground"
              role="alert"
            >
              {error}
            </span>
          ) : (
            <span className="min-w-0 flex-1 basis-0 truncate text-xs leading-tight text-muted-foreground">
              {line.product.category.name}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="-my-1.5">
          <LineBatch line={line} />
        </div>
      </TableCell>
      <TableCell>
        <div className="-my-1.5 flex items-center gap-1">
          <NumberField
            className="w-16"
            format={{ useGrouping: false }}
            min={1}
            onValueChange={(quantity) => updateLine(line.key, { quantity })}
            size="sm"
            step={1}
            value={line.quantity}
          >
            <NumberFieldGroup>
              <NumberFieldInput
                aria-invalid={error ? true : undefined}
                aria-label={`Quantity of ${line.product.name}`}
                onKeyDown={returnOnEnter}
              />
            </NumberFieldGroup>
          </NumberField>
          {line.product.category.tracksPacks ? (
            <Select
              items={quantityItems}
              onValueChange={(value) => value && setLineQuantityUnit(line.key, value)}
              value={line.quantityUnit}
            >
              <SelectTrigger aria-label="Quantity unit" className="w-20 min-w-0" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {quantityItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : (
            <span className="text-xs text-muted-foreground">
              {pluralize(line.quantity ?? 0, "unit")}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="-my-1.5 flex items-center justify-end gap-1.5">
          {priceChanged && (
            <span className="text-xs text-muted-foreground tabular-nums line-through">
              {formatPrice(Math.round((suggested ?? 0) * 100))}
            </span>
          )}
          <NumberField
            className="w-20"
            format={{ maximumFractionDigits: 2, minimumFractionDigits: 0 }}
            min={0}
            onValueChange={(salePrice) => updateLine(line.key, { salePrice })}
            size="sm"
            step={1}
            value={line.salePrice}
          >
            <NumberFieldGroup>
              <NumberFieldInput
                aria-label={`Unit price of ${line.product.name} in PKR`}
                onKeyDown={returnOnEnter}
              />
            </NumberFieldGroup>
          </NumberField>
        </div>
      </TableCell>
      <TableCell>
        <span className="block text-end font-medium tabular-nums">
          {total == null ? EMPTY : formatPrice(total)}
        </span>
      </TableCell>
      <TableCell>
        <div className="-my-1.5 flex justify-end">
          <Button
            aria-label={`Remove ${line.product.name}`}
            onClick={(event) => {
              const row = event.currentTarget.closest("tr");
              if (row) remove(row);
            }}
            size="icon-sm"
            tabIndex={-1}
            variant="ghost"
          >
            <HugeiconsIcon aria-hidden="true" icon={Delete02Icon} />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export { InvoiceCreateLine };
