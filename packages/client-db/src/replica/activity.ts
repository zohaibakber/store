import {
  CommandReceipt,
  SyncCommandEnvelope,
  type CommandStatus,
  type SyncCommand,
  type SyncEntity,
} from "@store/contracts";
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
};

export const EMPTY_SYNC_ACTIVITY: InventorySyncActivity = {
  pendingCount: 0,
  rejectedCount: 0,
  rejected: [],
  lastCaughtUpAt: null,
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
        targets: uniqueTargets(
          command.payload.writes.map((write) => ({ entity: write.entity, id: write.id })),
        ),
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
