import { SentIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { PurchaseOrder, Supplier } from "@store/contracts";
import * as React from "react";

import {
  hasOpenPopup,
  isEditableTarget,
  isPlainKey,
  useWindowKeydown,
} from "@/components/products/shortcuts";
import { ShortcutButton } from "@/components/shared/shortcut-button";
import { toastManager } from "@/components/ui/toast";
import { toastStoreError } from "@/lib/errors";
import { useInventoryActions } from "@/lib/inventory";

import { formatOrderNumber } from "./presentation";

export type SendOrderActionProps = {
  readonly disabled: boolean;
  readonly order: PurchaseOrder;
  readonly supplier: Supplier | undefined;
};

export function SendOrderAction({ disabled, order }: SendOrderActionProps) {
  const { sendOrder } = useInventoryActions();
  const [pending, setPending] = React.useState(false);
  const hasLines = order.items.length > 0;
  const canSend = !disabled && !pending && hasLines;

  const send = async () => {
    if (!canSend) return;
    setPending(true);
    try {
      await sendOrder(order.id);
      toastManager.add({
        title: `Order ${formatOrderNumber(order.orderNumber)} marked as sent`,
        type: "success",
      });
    } catch (error) {
      toastStoreError(error, "Could not send the order.");
    }
    setPending(false);
  };

  useWindowKeydown((event) => {
    if (event.defaultPrevented || event.repeat) return;
    if (isEditableTarget(event.target) || hasOpenPopup()) return;
    if (!isPlainKey(event, "s")) return;
    event.preventDefault();
    void send();
  });

  return (
    <ShortcutButton
      disabled={!canSend}
      label={hasLines ? "Mark as sent" : "Add a line before sending"}
      loading={pending}
      onClick={() => void send()}
      shortcut="S"
    >
      <HugeiconsIcon aria-hidden="true" icon={SentIcon} />
      Send
    </ShortcutButton>
  );
}
