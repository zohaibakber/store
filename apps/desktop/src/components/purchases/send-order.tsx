import {
  ArrowDown01Icon,
  Copy01Icon,
  Pdf01Icon,
  SentIcon,
  WhatsappIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { PurchaseOrder, PurchaseOrderItem, Supplier } from "@store/contracts";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
import { formatPrice } from "@store/services/format";
import {
  purchaseOrderCostTotal,
  purchaseOrderText,
  whatsAppLink,
  type WhatsAppLink,
} from "@store/services/purchasing";
import * as React from "react";
import { createPortal } from "react-dom";

import {
  hasOpenPopup,
  isEditableTarget,
  isPlainKey,
  useWindowKeydown,
} from "@/components/products/shortcuts";
import { ShortcutButton } from "@/components/shared/shortcut-button";
import { Button } from "@/components/ui/button";
import { Group, GroupSeparator } from "@/components/ui/group";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { toastManager } from "@/components/ui/toast";
import { appHost } from "@/host";
import { useAuth } from "@/lib/auth";
import { toastStoreError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { useInventoryActions } from "@/lib/inventory";

import {
  byProductName,
  formatLineQuantity,
  formatOrderNumber,
  UNKNOWN_SUPPLIER,
} from "./presentation";

export type SendOrderActionProps = {
  readonly canMarkSent: boolean;
  readonly order: PurchaseOrder;
  readonly supplier: Supplier | undefined;
};

type Delivery = "whatsapp" | "copy";

const ORDER_TEXT_FORMAT = { date: formatDate, quantity: formatLineQuantity };

const whatsAppUnavailable = (link: WhatsAppLink): string | null => {
  switch (link._tag) {
    case "Ready":
      return null;
    case "NoPhone":
      return "This supplier has no WhatsApp number.";
    case "TooLong":
      return "This order is too long for a WhatsApp link.";
  }
};

const deliveryFailure = (delivery: Delivery) => {
  switch (delivery) {
    case "whatsapp":
      return "Could not open WhatsApp.";
    case "copy":
      return "Could not copy the order.";
  }
};

const deliveryDone = (delivery: Delivery) => {
  switch (delivery) {
    case "whatsapp":
      return "Order opened in WhatsApp";
    case "copy":
      return "Order text copied";
  }
};

const primaryHint = (delivery: Delivery, draft: boolean, unavailable: string | null) => {
  switch (delivery) {
    case "whatsapp":
      return draft ? "Send on WhatsApp and mark as sent" : "Send again on WhatsApp";
    case "copy":
      return unavailable === null
        ? "Copy the order text"
        : `${unavailable} Copy the order text instead`;
  }
};

function OrderPrintView({
  lines,
  order,
  storeName,
  supplier,
}: {
  readonly lines: ReadonlyArray<PurchaseOrderItem>;
  readonly order: PurchaseOrder;
  readonly storeName: string | null;
  readonly supplier: Supplier | undefined;
}) {
  const total = purchaseOrderCostTotal(order, lines);
  return createPortal(
    <div className="hidden bg-background text-sm text-foreground print:block" data-print-root="">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-lg font-medium">
              Purchase order{" "}
              <span className="tabular-nums">{formatOrderNumber(order.orderNumber)}</span>
            </p>
            {storeName === null ? null : <p>{storeName}</p>}
          </div>
          <div className="flex flex-col gap-1 text-end tabular-nums">
            <p>{formatDate(order.createdAt)}</p>
            {order.expectedAt === null ? null : <p>Expected {formatDate(order.expectedAt)}</p>}
          </div>
        </div>
        <p>
          <span className="text-muted-foreground">To </span>
          <span className="font-medium">{supplier?.name ?? UNKNOWN_SUPPLIER}</span>
          {supplier?.phone ? <span className="tabular-nums"> · {supplier.phone}</span> : null}
        </p>
        <table className="w-full border-collapse text-start">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="w-8 py-1 text-start font-medium">#</th>
              <th className="py-1 text-start font-medium">Product</th>
              <th className="w-32 py-1 text-end font-medium">Quantity</th>
              <th className="w-32 py-1 text-end font-medium">Pack cost</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr className="break-inside-avoid border-b" key={line.id}>
                <td className="py-1 tabular-nums">{index + 1}</td>
                <td className="py-1 capitalize">{line.productName}</td>
                <td className="py-1 text-end tabular-nums">{formatLineQuantity(line)}</td>
                <td className="py-1 text-end tabular-nums">
                  {line.packCost === null ? null : formatPrice(line.packCost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {total === null ? null : (
          <p className="text-end text-base font-medium tabular-nums">Total {formatPrice(total)}</p>
        )}
        {order.note ? <p className="whitespace-pre-wrap">{order.note}</p> : null}
      </div>
    </div>,
    document.body,
  );
}

export function SendOrderAction({ canMarkSent, order, supplier }: SendOrderActionProps) {
  const { sendOrder } = useInventoryActions();
  const { workspace } = useAuth();
  const [pending, setPending] = React.useState(false);

  const storeName = workspace._tag === "Organization" ? workspace.organization.name : null;
  const lines = [...order.items].sort(byProductName);
  const text = purchaseOrderText({ storeName, order, lines, supplier, format: ORDER_TEXT_FORMAT });
  const link = whatsAppLink(supplier?.phone, text);
  const unavailable = whatsAppUnavailable(link);
  const number = formatOrderNumber(order.orderNumber);
  const markedSent = `Order ${number} marked as sent`;

  const draft = order.status === "draft";
  const hasLines = lines.length > 0;
  const canShare = hasLines && !pending;
  const canDeliver = canShare && (!draft || canMarkSent);
  const primary: Delivery = link._tag === "Ready" ? "whatsapp" : "copy";

  const hand = async (delivery: Delivery) => {
    switch (delivery) {
      case "whatsapp":
        if (link._tag !== "Ready") throw new Error("WhatsApp is unavailable for this order.");
        return appHost().openExternal(link.url);
      case "copy":
        return appHost().copyText(text);
    }
  };

  const markSent = async (title: string, description?: string) => {
    try {
      await sendOrder(order.id);
      toastManager.add({ title, description, type: "success" });
    } catch (error) {
      toastStoreError(error, "Could not mark the order as sent.");
    }
  };

  const deliver = async (delivery: Delivery) => {
    if (!canDeliver) return;
    setPending(true);
    try {
      await hand(delivery);
    } catch (error) {
      toastStoreError(error, deliveryFailure(delivery));
      setPending(false);
      return;
    }
    if (draft) await markSent(deliveryDone(delivery), markedSent);
    else toastManager.add({ title: deliveryDone(delivery), type: "success" });
    setPending(false);
  };

  const markOnly = async () => {
    if (!canDeliver || !draft) return;
    setPending(true);
    await markSent(markedSent);
    setPending(false);
  };

  const savePdf = async () => {
    if (!canShare) return;
    setPending(true);
    try {
      const outcome = await appHost().savePdf(`order-${formatInvoiceNumber(order.orderNumber)}`);
      switch (outcome._tag) {
        case "saved":
          toastManager.add({ title: `Saved ${outcome.fileName}`, type: "success" });
          break;
        case "failed":
          toastManager.add({ title: outcome.message, type: "error" });
          break;
        case "printed":
        case "cancelled":
          break;
      }
    } catch (error) {
      toastStoreError(error, "Could not save the PDF.");
    }
    setPending(false);
  };

  useWindowKeydown((event) => {
    if (event.defaultPrevented || event.repeat) return;
    if (isEditableTarget(event.target) || hasOpenPopup()) return;
    if (!isPlainKey(event, "s")) return;
    event.preventDefault();
    void deliver(primary);
  });

  const variant = draft ? "default" : "outline";
  const primaryLabel = hasLines
    ? primaryHint(primary, draft, unavailable)
    : "Add a line before sending";

  return (
    <>
      <Group>
        <ShortcutButton
          disabled={!canDeliver}
          label={primaryLabel}
          loading={pending}
          onClick={() => void deliver(primary)}
          shortcut="S"
          variant={variant}
        >
          <HugeiconsIcon
            aria-hidden="true"
            icon={primary === "whatsapp" ? WhatsappIcon : Copy01Icon}
          />
          {primary === "whatsapp" ? "Send" : "Copy order"}
        </ShortcutButton>
        <GroupSeparator />
        <Menu>
          <MenuTrigger
            render={
              <Button
                aria-label="More ways to send"
                disabled={!canShare}
                size="icon-sm"
                variant={variant}
              />
            }
          >
            <HugeiconsIcon aria-hidden="true" icon={ArrowDown01Icon} />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuGroup>
              {unavailable === null ? null : <MenuGroupLabel>{unavailable}</MenuGroupLabel>}
              <MenuItem
                disabled={!canDeliver || link._tag !== "Ready"}
                onClick={() => void deliver("whatsapp")}
              >
                <HugeiconsIcon aria-hidden="true" icon={WhatsappIcon} />
                Send on WhatsApp
              </MenuItem>
              <MenuItem disabled={!canDeliver} onClick={() => void deliver("copy")}>
                <HugeiconsIcon aria-hidden="true" icon={Copy01Icon} />
                Copy order text
              </MenuItem>
              <MenuItem onClick={() => void savePdf()}>
                <HugeiconsIcon aria-hidden="true" icon={Pdf01Icon} />
                Save as PDF
              </MenuItem>
            </MenuGroup>
            {draft ? (
              <>
                <MenuSeparator />
                <MenuItem disabled={!canDeliver} onClick={() => void markOnly()}>
                  <HugeiconsIcon aria-hidden="true" icon={SentIcon} />
                  Mark as sent
                </MenuItem>
              </>
            ) : null}
          </MenuPopup>
        </Menu>
      </Group>
      <OrderPrintView lines={lines} order={order} storeName={storeName} supplier={supplier} />
    </>
  );
}
