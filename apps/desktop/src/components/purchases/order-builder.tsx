import * as React from "react";

import { AsyncBoundary } from "@/components/app/error-boundary";
import { LoadingSpinner } from "@/components/app/loading-spinner";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet";

import type { DraftLine } from "./presentation";

const OrderBuilderBody = React.lazy(() =>
  import("./order-builder-body").then((module) => ({ default: module.OrderBuilderBody })),
);

const NO_LINES: ReadonlyArray<DraftLine> = [];

export function OrderBuilderSheet({
  onOpenChange,
  onOrdered,
  open,
  seed = NO_LINES,
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly onOrdered?: (productIds: ReadonlyArray<string>) => void;
  readonly open: boolean;
  readonly seed?: ReadonlyArray<DraftLine>;
}) {
  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetPopup className="sm:max-w-3xl" showCloseButton={false} variant="inset">
        <SheetHeader>
          <SheetTitle>New purchase order</SheetTitle>
          <SheetDescription>
            One draft is created per supplier. Nothing is sent until you send it.
          </SheetDescription>
        </SheetHeader>
        {open ? (
          <AsyncBoundary
            failed={
              <SheetPanel>
                <p className="text-sm text-destructive-foreground">
                  The order builder could not be loaded. Close it and try again.
                </p>
              </SheetPanel>
            }
            fallback={
              <SheetPanel>
                <LoadingSpinner className="h-48" />
              </SheetPanel>
            }
          >
            <OrderBuilderBody onOrdered={onOrdered} seed={seed} />
          </AsyncBoundary>
        ) : null}
      </SheetPopup>
    </Sheet>
  );
}
