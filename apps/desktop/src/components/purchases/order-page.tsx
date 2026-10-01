import { Alert02Icon, PackageReceiveIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  canMovePurchaseOrder,
  isPurchaseOrderOpen,
  purchaseOrderLineRemaining,
  type PurchaseOrder,
  type PurchaseOrderItem,
  type StockMovement,
  type Supplier,
} from "@store/contracts";
import { formatPrice } from "@store/services/format";
import { Link } from "@tanstack/react-router";
import * as React from "react";

import {
  hasOpenPopup,
  isEditableTarget,
  isPlainKey,
  useWindowKeydown,
} from "@/components/products/shortcuts";
import { formatDelta } from "@/components/products/stock";
import { FrameCard } from "@/components/shared/frame-card";
import {
  PageAction,
  PageContent,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/shared/page-layout";
import { ShortcutButton } from "@/components/shared/shortcut-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toastManager } from "@/components/ui/toast";
import { toastStoreError } from "@/lib/errors";
import { EMPTY, formatCount, formatDate, formatDateTime } from "@/lib/format";
import { useInventoryActions, usePurchasingGate } from "@/lib/inventory";

import { PurchasingGateNotice } from "./gate-notice";
import {
  byProductName,
  formatLineQuantity,
  formatOrderNumber,
  orderProgress,
  orderUnits,
  UNKNOWN_SUPPLIER,
} from "./presentation";
import { ProgressBadge } from "./progress-badge";
import { ReceiveDeliverySheet } from "./receive-delivery-sheet";
import { SendOrderAction } from "./send-order";

type Confirmation = "close" | "cancel";

const muted = <span className="text-muted-foreground">{EMPTY}</span>;

export function PurchaseOrderError({ error }: { readonly error: unknown }) {
  const message = error instanceof Error ? error.message : "The order could not be loaded.";
  return (
    <PageLayout width="narrow">
      <PageContent>
        <Alert variant="error">
          <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
          <AlertTitle>Could not load order</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        <div>
          <Button render={<Link to="/purchases" />} size="sm" variant="outline">
            Back to purchases
          </Button>
        </div>
      </PageContent>
    </PageLayout>
  );
}

function EndHead({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className: string;
}) {
  return (
    <TableHead className={className}>
      <span className="block text-end">{children}</span>
    </TableHead>
  );
}

function EndCell({ children }: { readonly children: React.ReactNode }) {
  return (
    <TableCell>
      <span className="block text-end tabular-nums">{children}</span>
    </TableCell>
  );
}

function LineRow({ item }: { readonly item: PurchaseOrderItem }) {
  const remaining = purchaseOrderLineRemaining(item);
  return (
    <TableRow>
      <TableCell className="max-w-0">
        <Link
          className="block truncate leading-tight font-medium capitalize outline-none hover:underline focus-visible:underline"
          params={{ productId: item.productId }}
          to="/products/$productId"
        >
          {item.productName}
        </Link>
      </TableCell>
      <EndCell>
        {formatLineQuantity(item)}
        {item.quantityType === "pack" ? (
          <span className="text-muted-foreground">
            {" "}
            · {formatCount(item.baseUnitQuantity, "unit")}
          </span>
        ) : null}
      </EndCell>
      <EndCell>
        {item.receivedBaseUnits === 0 ? muted : formatCount(item.receivedBaseUnits, "unit")}
      </EndCell>
      <EndCell>{remaining === 0 ? muted : formatCount(remaining, "unit")}</EndCell>
      <EndCell>{item.packCost === null ? muted : formatPrice(item.packCost)}</EndCell>
    </TableRow>
  );
}

function LinesCard({ order }: { readonly order: PurchaseOrder }) {
  const units = orderUnits(order.items);
  const lines = [...order.items].sort(byProductName);
  return (
    <FrameCard
      description={`${formatCount(order.items.length, "line")} · ${formatCount(units.received, "unit")} of ${formatCount(units.ordered, "unit")} received`}
      table={order.items.length > 0}
      title="Lines"
    >
      {order.items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No lines on this order</EmptyTitle>
            <EmptyDescription>Cancel it and start a new order from Restock.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table className="table-fixed" variant="card">
          <TableHeader>
            <TableRow>
              <TableHead className="h-8">Product</TableHead>
              <EndHead className="h-8 w-48">Ordered</EndHead>
              <EndHead className="h-8 w-32">Received</EndHead>
              <EndHead className="h-8 w-32">Remaining</EndHead>
              <EndHead className="h-8 w-32">Pack cost</EndHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((item) => (
              <LineRow item={item} key={item.id} />
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4}>
                <span className="block text-end text-base font-medium">Total</span>
              </TableCell>
              <TableCell>
                <span className="block text-end text-base font-medium tabular-nums">
                  {formatPrice(order.total)}
                </span>
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </FrameCard>
  );
}

function DeliveriesCard({
  deliveries,
  open,
  order,
}: {
  readonly deliveries: ReadonlyArray<StockMovement>;
  readonly open: boolean;
  readonly order: PurchaseOrder;
}) {
  const names = new Map(order.items.map((item) => [item.productId, item.productName]));
  return (
    <FrameCard
      description={deliveries.length === 0 ? undefined : formatCount(deliveries.length, "receipt")}
      table={deliveries.length > 0}
      title="Deliveries"
    >
      {deliveries.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing received yet</EmptyTitle>
            <EmptyDescription>
              {open ? (
                <>
                  Press <Kbd>R</Kbd> when the delivery arrives.
                </>
              ) : (
                "No stock was received against this order."
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table className="table-fixed" variant="card">
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 w-48">Date</TableHead>
              <TableHead className="h-8">Product</TableHead>
              <EndHead className="h-8 w-40">Quantity</EndHead>
              <TableHead className="h-8 w-64">Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.map((movement) => (
              <TableRow key={movement.id}>
                <TableCell>
                  <span className="text-muted-foreground tabular-nums">
                    {formatDateTime(movement.createdAt)}
                  </span>
                </TableCell>
                <TableCell className="max-w-0">
                  <span className="block truncate capitalize">
                    {names.get(movement.productId) ?? muted}
                  </span>
                </TableCell>
                <EndCell>{formatDelta(movement.packDelta, movement.unitDelta)}</EndCell>
                <TableCell className="max-w-0">
                  <span className="block truncate text-muted-foreground">
                    {movement.note ?? EMPTY}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </FrameCard>
  );
}

export function PurchaseOrderPage({
  deliveries,
  onReceiveOpenChange,
  order,
  receiveOpen,
  supplier,
}: {
  readonly deliveries: ReadonlyArray<StockMovement>;
  readonly onReceiveOpenChange: (open: boolean) => void;
  readonly order: PurchaseOrder;
  readonly receiveOpen: boolean;
  readonly supplier: Supplier | undefined;
}) {
  const { cancelOrder, closeOrder } = useInventoryActions();
  const gate = usePurchasingGate();
  const [confirmation, setConfirmation] = React.useState<Confirmation>("close");
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const open = isPurchaseOrderOpen(order.status);
  const canMove = (to: PurchaseOrder["status"]) =>
    !gate.blocked && order.status !== to && canMovePurchaseOrder(order.status, to);
  const canSend = canMove("sent");
  const canClose = canMove("closed");
  const canCancel = canMove("cancelled");
  const canReceive = !gate.blocked && open && order.items.length > 0;
  const units = orderUnits(order.items);
  const number = formatOrderNumber(order.orderNumber);

  const confirm = (kind: Confirmation) => {
    setConfirmation(kind);
    setConfirming(true);
  };

  const run = async (kind: Confirmation) => {
    setPending(true);
    try {
      switch (kind) {
        case "close":
          await closeOrder(order.id);
          toastManager.add({ title: `Order ${number} closed`, type: "success" });
          break;
        case "cancel":
          await cancelOrder(order.id);
          toastManager.add({ title: `Order ${number} cancelled`, type: "success" });
          break;
      }
    } catch (error) {
      toastStoreError(error, "Could not update the order.");
    }
    setPending(false);
  };

  useWindowKeydown((event) => {
    if (event.defaultPrevented || event.repeat) return;
    if (isEditableTarget(event.target) || hasOpenPopup()) return;
    if (!isPlainKey(event, "r") || !canReceive) return;
    event.preventDefault();
    onReceiveOpenChange(true);
  });

  const summary = [
    supplier?.name ?? UNKNOWN_SUPPLIER,
    ...(supplier?.phone ? [supplier.phone] : []),
    `Created ${formatDate(order.createdAt)}`,
    ...(order.sentAt === null ? [] : [`Sent ${formatDate(order.sentAt)}`]),
    ...(order.expectedAt === null ? [] : [`Expected ${formatDate(order.expectedAt)}`]),
  ].join(" · ");

  return (
    <PageLayout>
      <PageHeader>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <PageHeading>
              Order <span className="tabular-nums">{number}</span>
            </PageHeading>
            <ProgressBadge progress={orderProgress(order)} />
          </div>
          <p className="truncate text-sm text-muted-foreground tabular-nums">{summary}</p>
        </div>
        {open ? (
          <PageAction>
            <Button
              disabled={!canCancel || pending}
              onClick={() => confirm("cancel")}
              size="sm"
              variant="ghost"
            >
              Cancel order
            </Button>
            <Button
              disabled={!canClose || pending}
              onClick={() => confirm("close")}
              size="sm"
              variant="outline"
            >
              Close
            </Button>
            <ShortcutButton
              disabled={!canReceive}
              label="Receive delivery"
              onClick={() => onReceiveOpenChange(true)}
              shortcut="R"
              variant={canSend ? "outline" : "default"}
            >
              <HugeiconsIcon aria-hidden="true" icon={PackageReceiveIcon} />
              Receive
            </ShortcutButton>
            <SendOrderAction canMarkSent={canSend} order={order} supplier={supplier} />
          </PageAction>
        ) : null}
      </PageHeader>

      <AlertDialog onOpenChange={setConfirming} open={confirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation === "cancel" ? `Cancel order ${number}?` : `Close order ${number}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation === "cancel"
                ? units.received > 0
                  ? "Stock already received stays in your inventory. The order can no longer be changed or received."
                  : "The order keeps its number and can no longer be changed or received."
                : units.received < units.ordered
                  ? `${formatCount(units.ordered - units.received, "unit")} not yet received will no longer count as on order.`
                  : "Everything on this order has been received."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>Keep order</AlertDialogClose>
            <AlertDialogClose
              onClick={() => void run(confirmation)}
              render={<Button variant={confirmation === "cancel" ? "destructive" : "default"} />}
            >
              {confirmation === "cancel" ? "Cancel order" : "Close order"}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReceiveDeliverySheet
        onOpenChange={onReceiveOpenChange}
        open={receiveOpen && canReceive}
        order={order}
        supplier={supplier}
      />

      <PageContent>
        <PurchasingGateNotice gate={gate} />
        {order.note ? (
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">{order.note}</p>
        ) : null}
        <LinesCard order={order} />
        <DeliveriesCard deliveries={deliveries} open={open} order={order} />
      </PageContent>
    </PageLayout>
  );
}
