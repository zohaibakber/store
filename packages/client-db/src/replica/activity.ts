import {
  CommandReceipt,
  SyncCommandEnvelope,
  type CommandStatus,
  type SyncCommand,
  type SyncEntity,
  type SyncProtocolCode,
} from "@store/contracts";
import type { CatalogRowWrite } from "@store/contracts/catalog-write";
import type { OutboxActivityRow, ReplicaOutboxActivity } from "@store/sync/browser";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { syncStatusFromOutbox, type InventorySyncStatus } from "./status";

export type RejectedCommandTarget = {
  readonly entity: SyncEntity;
  readonly id: string;
};

export type RejectedCommand = {
  readonly operationId: string;
  readonly clientSequence: string;
  readonly createdAt: number;
  readonly command: SyncCommand["_tag"];
  readonly code: string;
  readonly message: string;
  readonly targets: ReadonlyArray<RejectedCommandTarget>;
  readonly productId: string | null;
};

export type InventorySyncActivity = {
  readonly pendingCount: number;
  readonly rejectedCount: number;
  readonly rejected: ReadonlyArray<RejectedCommand>;
  readonly lastCaughtUpAt: number | null;
  readonly firstSyncPending: boolean;
  readonly lowestActiveSchemaVersion: number | null;
};

export const EMPTY_SYNC_ACTIVITY: InventorySyncActivity = {
  pendingCount: 0,
  rejectedCount: 0,
  rejected: [],
  lastCaughtUpAt: null,
  firstSyncPending: false,
  lowestActiveSchemaVersion: null,
};

const PENDING_STATUSES: ReadonlySet<CommandStatus> = new Set([
  "pending",
  "sending",
  "accepted_awaiting_integration",
]);

const UNKNOWN_REJECTION = {
  code: "UNKNOWN",
  message: "The server rejected this change.",
} as const;

const decodeEnvelope = Schema.decodeUnknownOption(Schema.fromJsonString(SyncCommandEnvelope));
const decodeReceipt = Schema.decodeUnknownOption(Schema.fromJsonString(CommandReceipt));

const uniqueTargets = (
  targets: ReadonlyArray<RejectedCommandTarget>,
): ReadonlyArray<RejectedCommandTarget> => {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.entity}:${target.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const writeTargets = (write: CatalogRowWrite): ReadonlyArray<RejectedCommandTarget> => {
  const target = { entity: write.entity, id: write.id };
  return write.entity === "batch" && write.action === "upsert" && write.receipt !== undefined
    ? [target, { entity: "purchaseOrderItem", id: write.receipt.purchaseOrderItemId }]
    : [target];
};

export type CommandTargets = {
  readonly targets: ReadonlyArray<RejectedCommandTarget>;
  readonly productId: string | null;
};

export const commandTargets = (command: SyncCommand): CommandTargets => {
  switch (command._tag) {
    case "catalogWrite": {
      const productIds = command.payload.writes.flatMap((write) => {
        if (write.entity === "product") return [write.id];
        if (write.entity === "batch" && write.action === "upsert") return [write.row.productId];
        return [];
      });
      return {
        targets: uniqueTargets(command.payload.writes.flatMap(writeTargets)),
        productId: productIds[0] ?? null,
      };
    }
    case "issueInvoice": {
      const productIds = command.payload.input.items.map((item) => item.productId);
      return {
        targets: uniqueTargets([
          { entity: "invoice", id: command.payload.invoiceId },
          ...productIds.map((id) => ({ entity: "product" as const, id })),
        ]),
        productId: productIds[0] ?? null,
      };
    }
  }
};

export type RejectedCommandSubject = "sale" | "delivery" | "purchaseOrder" | "supplier" | "stock";

export const rejectedCommandSubject = (
  rejected: Pick<RejectedCommand, "command" | "targets">,
): RejectedCommandSubject => {
  switch (rejected.command) {
    case "issueInvoice":
      return "sale";
    case "catalogWrite": {
      const entities = new Set(rejected.targets.map((target) => target.entity));
      const onOrderLine = entities.has("purchaseOrderItem");
      if (onOrderLine && entities.has("batch")) return "delivery";
      if (onOrderLine || entities.has("purchaseOrder")) return "purchaseOrder";
      return entities.has("supplier") ? "supplier" : "stock";
    }
  }
};

const SUBJECT_NOUNS = {
  sale: "Sale",
  delivery: "Delivery",
  purchaseOrder: "Purchase order",
  supplier: "Supplier",
  stock: "Stock change",
} as const satisfies Record<RejectedCommandSubject, string>;

const REJECTION_REASONS: ReadonlyMap<string, string> = new Map(
  Object.entries({
    INSUFFICIENT_STOCK: "Not enough stock",
    ENTITY_CONFLICT: "Changed on another device",
    ENTITY_RELATION_INVALID: "Linked item is missing",
    ENTITY_WRITE_FAILED: "Couldn't be saved on the server",
    INVOICE_IDENTITY_CONFLICT: "Invoice number already used",
    INVALID_OPERATION: "Not allowed",
    SUPPLIER_HAS_ORDERS: "Supplier still has purchase orders",
    PURCHASE_ORDER_TRANSITION_INVALID: "Order status changed on another device",
    PURCHASE_ORDER_NOT_OPEN: "Order is already closed or cancelled",
    PURCHASE_ORDER_NOT_DRAFT: "Only a draft order can be deleted",
    PURCHASE_ORDER_HAS_ITEMS: "Remove the order's lines first",
    PURCHASE_ORDER_ITEM_QUANTITY_INVALID: "Pack size changed; enter the quantity again",
    PURCHASE_ORDER_ITEM_RECEIVED: "Line already has received stock",
    PURCHASE_ORDER_RECEIPT_PRODUCT_MISMATCH: "Delivery is for a different product",
    REPLICA_SCHEMA_OUTDATED: "Update Tabaaq on your other devices first",
  } satisfies Partial<Record<SyncProtocolCode, string>>),
);

export const rejectionReason = (code: string): string => REJECTION_REASONS.get(code) ?? "Rejected";

export type RejectedCommandLabel = {
  readonly subject: RejectedCommandSubject;
  readonly title: string;
  readonly detail: string;
};

export const rejectedCommandLabel = (
  rejected: Pick<RejectedCommand, "command" | "targets" | "code" | "message">,
): RejectedCommandLabel => {
  const subject = rejectedCommandSubject(rejected);
  return {
    subject,
    title: `${SUBJECT_NOUNS[subject]}: ${rejectionReason(rejected.code)}`,
    detail: rejected.message,
  };
};

export const rejectedCommandFromOutbox = (row: OutboxActivityRow): Option.Option<RejectedCommand> =>
  decodeEnvelope(row.envelopeJson).pipe(
    Option.map((envelope) => {
      const receipt = row.receiptJson === null ? Option.none() : decodeReceipt(row.receiptJson);
      const rejection = Option.match(receipt, {
        onNone: () => UNKNOWN_REJECTION,
        onSome: (decoded) =>
          decoded.result._tag === "rejected"
            ? { code: decoded.result.code, message: decoded.result.message }
            : UNKNOWN_REJECTION,
      });
      return {
        operationId: row.operationId,
        clientSequence: row.clientSequence,
        createdAt: row.createdAt,
        command: envelope.command._tag,
        code: rejection.code,
        message: rejection.message,
        ...commandTargets(envelope.command),
      } satisfies RejectedCommand;
    }),
  );

export const syncActivityFromOutbox = (activity: ReplicaOutboxActivity): InventorySyncActivity => {
  let pendingCount = 0;
  let rejectedCount = 0;
  for (const entry of activity.statusCounts) {
    if (PENDING_STATUSES.has(entry.status)) pendingCount += entry.count;
    if (entry.status === "rejected") rejectedCount += entry.count;
  }
  return {
    pendingCount,
    rejectedCount,
    rejected: activity.rejected.flatMap((row) => Option.toArray(rejectedCommandFromOutbox(row))),
    lastCaughtUpAt: activity.caughtUpAt,
    firstSyncPending: activity.caughtUpAt === null,
    lowestActiveSchemaVersion: activity.lowestActiveSchemaVersion,
  };
};

export const syncStatusFromActivity = (activity: ReplicaOutboxActivity): InventorySyncStatus =>
  syncStatusFromOutbox(
    activity.statusCounts.filter((entry) => entry.count > 0).map((entry) => entry.status),
  );

export const syncActivityFromStatuses = (
  statuses: ReadonlyArray<CommandStatus>,
): InventorySyncActivity => ({
  ...EMPTY_SYNC_ACTIVITY,
  pendingCount: statuses.filter((status) => PENDING_STATUSES.has(status)).length,
  rejectedCount: statuses.filter((status) => status === "rejected").length,
});
