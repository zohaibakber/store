import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  purchaseOrderLineRemaining,
  type PurchaseOrder,
  type PurchaseOrderItem,
} from "@store/contracts";
import {
  useInventoryActions,
  usePurchasingGate,
  useSuspenseCatalogProductsById,
  type ReceiveDeliveryLineInput,
} from "@store/inventory-react";
import { formatPrice } from "@store/services/format";
import * as React from "react";

import { ExpiryPicker } from "@/components/shared/expiry-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Frame } from "@/components/ui/frame";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "@/components/ui/number-field";
import { SheetClose, SheetFooter, SheetPanel } from "@/components/ui/sheet";
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
import { EMPTY, formatCount } from "@/lib/format";
import { useSubmitShortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

import { PurchasingGateNotice } from "./gate-notice";
import { formatLineQuantity, formatOrderNumber } from "./presentation";
import {
  initialReceiveRows,
  MAX_BATCH_NUMBER_LENGTH,
  receiveLineInputs,
  receiveProductsOf,
  rowProblems,
  splitRow,
  summarizeDelivery,
  type ReceiveProduct,
  type ReceiveRow,
} from "./receive-lines";

const WHOLE_NUMBER = { maximumFractionDigits: 0, useGrouping: false } as const;

const MONEY = { maximumFractionDigits: 2, useGrouping: false } as const;

const muted = <span className="text-muted-foreground">{EMPTY}</span>;

const moveWithinColumn = (event: React.KeyboardEvent<HTMLTableSectionElement>) => {
  if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.altKey) return;
  if (!(event.target instanceof HTMLInputElement)) return;
  const cell = event.target.closest("td");
  const row = cell?.parentElement;
  if (!(cell instanceof HTMLTableCellElement) || !(row instanceof HTMLTableRowElement)) return;
  event.preventDefault();
  const step = (from: Element): Element | null =>
    event.shiftKey ? from.previousElementSibling : from.nextElementSibling;
  for (let next = step(row); next !== null; next = step(next)) {
    const input = next.children.item(cell.cellIndex)?.querySelector("input:not(:disabled)");
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
      return;
    }
  }
};

function CountField({
  invalid,
  label,
  onChange,
  value,
}: {
  readonly invalid: boolean;
  readonly label: string;
  readonly onChange: (value: number | null) => void;
  readonly value: number | null;
}) {
  return (
    <NumberField format={WHOLE_NUMBER} min={0} onValueChange={onChange} step={1} value={value}>
      <NumberFieldGroup>
        <NumberFieldInput aria-invalid={invalid || undefined} aria-label={label} placeholder="0" />
      </NumberFieldGroup>
    </NumberField>
  );
}

function ReceiveLineRow({
  entered,
  extra,
  item,
  onChange,
  onRemove,
  onSplit,
  product,
  row,
}: {
  readonly entered: number;
  readonly extra: boolean;
  readonly item: PurchaseOrderItem;
  readonly onChange: (patch: Partial<ReceiveRow>) => void;
  readonly onRemove: () => void;
  readonly onSplit: () => void;
  readonly product: ReceiveProduct | undefined;
  readonly row: ReceiveRow;
}) {
  const [year] = React.useState(() => new Date().getFullYear());
  const remaining = purchaseOrderLineRemaining(item);
  if (!product) {
    return (
      <TableRow>
        <TableCell className="max-w-0">
          <span className="block truncate font-medium capitalize">{item.productName}</span>
        </TableCell>
        <TableCell colSpan={6}>
          <span className="text-sm text-muted-foreground">
            This product no longer exists, so its line cannot be received.
          </span>
        </TableCell>
      </TableRow>
    );
  }
  const problems = rowProblems(row);
  const over = entered - remaining;
  return (
    <TableRow>
      <TableCell className="max-w-0">
        {extra ? (
          <span className="block truncate ps-3 text-sm text-muted-foreground">Another batch</span>
        ) : (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate leading-tight font-medium capitalize">
              {item.productName}
            </span>
            <span
              className={cn(
                "truncate text-xs leading-tight tabular-nums",
                over > 0 ? "text-warning-foreground" : "text-muted-foreground",
              )}
            >
              {over > 0
                ? `${formatCount(over, "unit")} more than the ${formatCount(remaining, "unit")} due`
                : `${formatLineQuantity(item)} ordered · ${formatCount(remaining, "unit")} due`}
            </span>
          </div>
        )}
      </TableCell>
      <TableCell>
        {product.tracksPacks ? (
          <Input
            aria-invalid={problems.has("batchNumber") || undefined}
            aria-label={`Batch number of ${item.productName}`}
            autoComplete="off"
            maxLength={MAX_BATCH_NUMBER_LENGTH}
            onChange={(event) => onChange({ batchNumber: event.target.value })}
            placeholder="Optional"
            value={row.batchNumber}
          />
        ) : (
          muted
        )}
      </TableCell>
      <TableCell>
        <ExpiryPicker
          endMonth={new Date(year + 15, 11)}
          onChange={(date) => onChange({ expiresAt: date ? date.getTime() : null })}
          startMonth={new Date(year - 1, 0)}
          value={row.expiresAt === null ? undefined : new Date(row.expiresAt)}
        />
      </TableCell>
      <TableCell>
        {product.tracksPacks ? (
          <CountField
            invalid={problems.has("quantity")}
            label={`Packs of ${item.productName} received`}
            onChange={(packs) => onChange({ packs })}
            value={row.packs}
          />
        ) : (
          muted
        )}
      </TableCell>
      <TableCell>
        <CountField
          invalid={problems.has("quantity")}
          label={`Units of ${item.productName} received`}
          onChange={(units) => onChange({ units })}
          value={row.units}
        />
      </TableCell>
      <TableCell>
        <NumberField
          format={MONEY}
          min={0}
          onValueChange={(cost) =>
            onChange({ cost: cost === null ? null : Math.round(cost * 100) })
          }
          step={1}
          value={row.cost === null ? null : row.cost / 100}
        >
          <NumberFieldGroup>
            <NumberFieldInput
              aria-invalid={problems.has("cost") || undefined}
              aria-label={`Cost of ${item.productName}`}
              className="text-end"
              placeholder={EMPTY}
            />
          </NumberFieldGroup>
        </NumberField>
      </TableCell>
      <TableCell>
        <div className="flex justify-end">
          {extra ? (
            <Button
              aria-label={`Remove this batch of ${item.productName}`}
              onClick={onRemove}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} />
            </Button>
          ) : (
            <Button
              aria-label={`Add another batch of ${item.productName}`}
              onClick={onSplit}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

type ReceiveDeliveryBodyProps = {
  readonly note?: string | null;
  readonly onDone: () => void;
  readonly onReceived?: () => void;
  readonly order: PurchaseOrder;
  readonly prefill?: ReadonlyArray<ReceiveDeliveryLineInput>;
};

export function ReceiveDeliveryBody({
  note,
  onDone,
  onReceived,
  order,
  prefill,
}: ReceiveDeliveryBodyProps) {
  const { receiveDelivery } = useInventoryActions();
  const gate = usePurchasingGate();
  const productIds = React.useMemo(
    () => [...new Set(order.items.map((item) => item.productId))].sort(),
    [order.items],
  );
  const products = useSuspenseCatalogProductsById(productIds);
  const productsById = React.useMemo(() => receiveProductsOf(products), [products]);
  const itemsById = React.useMemo(
    (): ReadonlyMap<string, PurchaseOrderItem> =>
      new Map(order.items.map((item) => [item.id, item])),
    [order.items],
  );
  const productOfItem = (itemId: string) => {
    const item = itemsById.get(itemId);
    return item ? productsById.get(item.productId) : undefined;
  };
  const [rows, setRows] = React.useState(() =>
    initialReceiveRows(order.items, (item) => productsById.get(item.productId), prefill),
  );
  const [closeChoice, setCloseChoice] = React.useState<boolean | null>(null);
  const [pending, setPending] = React.useState(false);
  const linesRef = React.useRef<HTMLTableSectionElement>(null);
  const closeId = React.useId();

  React.useEffect(() => {
    const first = linesRef.current?.querySelector("input:not(:disabled)");
    if (!(first instanceof HTMLInputElement)) return;
    first.focus();
    first.select();
  }, []);

  const summary = summarizeDelivery(order.items, rows, productOfItem);
  const invalid = rows.some((row) => rowProblems(row).size > 0);
  const closing = closeChoice ?? summary.completesOrder;
  const canReceive = !gate.blocked && !pending && !invalid && summary.lines > 0;
  const number = formatOrderNumber(order.orderNumber);

  const change = (key: string, patch: Partial<ReceiveRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const receive = async () => {
    if (!canReceive) return;
    setPending(true);
    try {
      const received = await receiveDelivery({
        orderId: order.id,
        lines: receiveLineInputs(rows, productOfItem),
        note: note ?? null,
        close: closing,
      });
      toastManager.add({
        title: `${formatCount(received.batches.length, "batch", "batches")} received on order ${number}`,
        description: closing ? "The order is now closed." : undefined,
        type: "success",
      });
      onReceived?.();
      onDone();
    } catch (error) {
      setPending(false);
      toastStoreError(error, "Could not record the delivery.");
    }
  };

  useSubmitShortcut(() => void receive());

  const firstRowOfItem = new Map<string, string>();
  for (const row of rows) {
    if (!firstRowOfItem.has(row.itemId)) firstRowOfItem.set(row.itemId, row.key);
  }

  const status =
    summary.lines === 0
      ? "Enter what arrived on at least one line"
      : invalid
        ? "Fix the highlighted fields"
        : `${formatCount(summary.lines, "batch", "batches")} · ${formatCount(summary.baseUnits, "unit")} · ${formatPrice(summary.cost)}`;

  return (
    <>
      <SheetPanel>
        <div className="flex flex-col gap-4">
          <PurchasingGateNotice gate={gate} />
          <Frame>
            <Table className="table-fixed" variant="card">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8">Product</TableHead>
                  <TableHead className="h-8 w-32">Batch</TableHead>
                  <TableHead className="h-8 w-32">Expiry</TableHead>
                  <TableHead className="h-8 w-20">Packs</TableHead>
                  <TableHead className="h-8 w-20">Units</TableHead>
                  <TableHead className="h-8 w-28">
                    <span className="block text-end">Cost</span>
                  </TableHead>
                  <TableHead className="h-8 w-10">
                    <span className="sr-only">Batches</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody onKeyDown={moveWithinColumn} ref={linesRef}>
                {rows.flatMap((row) => {
                  const item = itemsById.get(row.itemId);
                  if (!item) return [];
                  return [
                    <ReceiveLineRow
                      entered={summary.enteredByItem.get(row.itemId) ?? 0}
                      extra={firstRowOfItem.get(row.itemId) !== row.key}
                      item={item}
                      key={row.key}
                      onChange={(patch) => change(row.key, patch)}
                      onRemove={() =>
                        setRows((current) => current.filter((other) => other.key !== row.key))
                      }
                      onSplit={() =>
                        setRows((current) => splitRow(current, row.key, crypto.randomUUID()))
                      }
                      product={productOfItem(row.itemId)}
                      row={row}
                    />,
                  ];
                })}
              </TableBody>
            </Table>
          </Frame>
        </div>
      </SheetPanel>
      <SheetFooter className="sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={closeId}>
            <Checkbox
              checked={closing}
              id={closeId}
              onCheckedChange={(checked) => setCloseChoice(checked)}
            />
            Close the order after this delivery
          </Label>
          <p className="truncate text-sm text-muted-foreground tabular-nums">{status}</p>
        </div>
        <div className="flex gap-2">
          <SheetClose render={<Button size="sm" variant="ghost" />}>Cancel</SheetClose>
          <Button
            aria-keyshortcuts="Control+Enter"
            disabled={!canReceive}
            loading={pending}
            onClick={() => void receive()}
            size="sm"
            type="button"
          >
            Receive delivery
          </Button>
        </div>
      </SheetFooter>
    </>
  );
}
