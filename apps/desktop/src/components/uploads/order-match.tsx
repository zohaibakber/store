import { PackageReceiveIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  usePurchasingGate,
  useSuspenseOpenPurchaseOrders,
  useSuspenseSuppliers,
} from "@store/inventory-react";
import * as React from "react";

import {
  PROGRESS_META,
  UNKNOWN_SUPPLIER,
  formatOrderNumber,
  orderProgress,
  supplierNamesOf,
} from "@/components/purchases/presentation";
import { ReceiveDeliverySheet } from "@/components/purchases/receive-delivery-sheet";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCount } from "@/lib/format";

import { useUpload } from "./context";
import { deliveryNoteOf, matchOrders, matchSupplier, receivePrefillOf } from "./order-suggestion";

function UploadOrderMatch() {
  const {
    state: { changes, invoice },
    actions: { dropChanges },
    meta: { processing },
  } = useUpload();
  const suppliers = useSuspenseSuppliers();
  const orders = useSuspenseOpenPurchaseOrders();
  const gate = usePurchasingGate();
  const [chosenId, setChosenId] = React.useState<string | null>(null);
  const [receiving, setReceiving] = React.useState(false);

  const supplier = React.useMemo(
    () => matchSupplier(invoice?.supplier ?? null, suppliers),
    [invoice, suppliers],
  );
  const matches = React.useMemo(
    () => matchOrders(changes, orders, supplier),
    [changes, orders, supplier],
  );
  const match = matches.find((candidate) => candidate.order.id === chosenId) ?? matches[0];
  const prefill = React.useMemo(() => (match ? receivePrefillOf(match) : []), [match]);

  const reference = invoice?.invoiceNumber?.trim() || null;
  const printedSupplier = invoice?.supplier?.trim() || null;
  if (!match && reference === null && printedSupplier === null) return null;

  const supplierNames = supplierNamesOf(suppliers);
  const orderLabel = (order: (typeof orders)[number]) =>
    `${formatOrderNumber(order.orderNumber)} · ${supplierNames.get(order.supplierId) ?? UNKNOWN_SUPPLIER} · ${PROGRESS_META[orderProgress(order)].label}`;
  const items = matches.map((candidate) => ({
    label: orderLabel(candidate.order),
    value: candidate.order.id,
  }));
  const title = [
    reference === null ? "Invoice" : `Invoice ${reference}`,
    ...(printedSupplier === null ? [] : [`from ${printedSupplier}`]),
  ].join(" ");
  const supplierNote =
    printedSupplier === null
      ? null
      : supplier === undefined
        ? "No supplier with this name is saved yet."
        : supplier.name.trim().toLocaleLowerCase() === printedSupplier.toLocaleLowerCase()
          ? null
          : `Matched to your supplier ${supplier.name}.`;

  return (
    <>
      <Alert variant={match ? "info" : "default"}>
        <HugeiconsIcon aria-hidden="true" icon={PackageReceiveIcon} />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          {match ? (
            <p>
              {formatCount(match.lines.length, "line")} of {changes.length}{" "}
              {match.lines.length === 1 ? "is" : "are"} on order{" "}
              <span className="tabular-nums">{formatOrderNumber(match.order.orderNumber)}</span>.
              Receive them against the order so it shows what has arrived.
              {supplierNote ? ` ${supplierNote}` : ""}
            </p>
          ) : (
            <p>
              {supplierNote ? `${supplierNote} ` : ""}
              No open purchase order has these products.
            </p>
          )}
          {match && matches.length > 1 ? (
            <Select
              items={items}
              onValueChange={(orderId) => orderId && setChosenId(orderId)}
              value={match.order.id}
            >
              <SelectTrigger aria-label="Purchase order to receive against" size="sm">
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
          ) : null}
        </AlertDescription>
        {match ? (
          <AlertAction>
            <Button
              disabled={gate.blocked || processing}
              onClick={() => setReceiving(true)}
              size="sm"
              type="button"
            >
              Receive on order
            </Button>
          </AlertAction>
        ) : null}
      </Alert>
      {match ? (
        <ReceiveDeliverySheet
          note={deliveryNoteOf(match.order.orderNumber, reference)}
          onOpenChange={setReceiving}
          onReceived={() => dropChanges(match.lines.map((line) => line.change))}
          open={receiving}
          order={match.order}
          prefill={prefill}
          supplier={suppliers.find((known) => known.id === match.order.supplierId)}
        />
      ) : null}
    </>
  );
}

export { UploadOrderMatch };
