import type { PurchaseOrder, Supplier } from "@store/contracts";
import * as React from "react";

import { AppErrorBoundary } from "@/components/app/error-boundary";
import { LoadingSpinner } from "@/components/app/loading-spinner";
import { Kbd } from "@/components/ui/kbd";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ReceiveDeliveryLineInput } from "@/lib/inventory";

import { formatOrderNumber, UNKNOWN_SUPPLIER } from "./presentation";

const ReceiveDeliveryBody = React.lazy(() =>
  import("./receive-delivery-body").then((module) => ({ default: module.ReceiveDeliveryBody })),
);

export type ReceiveDeliverySheetProps = {
  readonly order: PurchaseOrder;
  readonly supplier: Supplier | undefined;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly prefill?: ReadonlyArray<ReceiveDeliveryLineInput>;
  readonly note?: string | null;
  readonly onReceived?: () => void;
};

export function ReceiveDeliverySheet({
  note,
  onOpenChange,
  onReceived,
  open,
  order,
  prefill,
  supplier,
}: ReceiveDeliverySheetProps) {
  const popupRef = React.useRef<HTMLDivElement>(null);
  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetPopup
        className="sm:max-w-4xl"
        initialFocus={() =>
          popupRef.current?.querySelector<HTMLInputElement>(
            "[data-slot=table-body] input:not(:disabled)",
          ) ?? true
        }
        ref={popupRef}
        variant="inset"
      >
        <SheetHeader>
          <SheetTitle>Receive delivery</SheetTitle>
          <SheetDescription>
            Order {formatOrderNumber(order.orderNumber)} from {supplier?.name ?? UNKNOWN_SUPPLIER}.
            Leave a line empty to skip it. <Kbd>Enter</Kbd> moves down a column, <Kbd>Ctrl</Kbd>{" "}
            <Kbd>Enter</Kbd> saves.
          </SheetDescription>
        </SheetHeader>
        {open ? (
          <AppErrorBoundary
            fallback={
              <SheetPanel>
                <p className="text-sm text-destructive-foreground">
                  The delivery form could not be loaded. Close it and try again.
                </p>
              </SheetPanel>
            }
          >
            <React.Suspense
              fallback={
                <SheetPanel>
                  <LoadingSpinner className="h-48" />
                </SheetPanel>
              }
            >
              <ReceiveDeliveryBody
                note={note}
                onDone={() => onOpenChange(false)}
                onReceived={onReceived}
                order={order}
                prefill={prefill}
              />
            </React.Suspense>
          </AppErrorBoundary>
        ) : null}
      </SheetPopup>
    </Sheet>
  );
}
