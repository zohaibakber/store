import type { CommandStatus } from "@store/contracts/sync/replica-model";

export const CAUGHT_UP_RECORD_INTERVAL_MILLIS = 60_000;

export const MAX_REJECTED_ACTIVITY_ROWS = 20;

export const ACTIVITY_COMMAND_STATUSES: ReadonlyArray<CommandStatus> = [
  "pending",
  "sending",
  "accepted_awaiting_integration",
  "rejected",
];

export type OutboxActivityRow = {
  readonly operationId: string;
  readonly clientSequence: string;
  readonly createdAt: number;
  readonly envelopeJson: string;
  readonly receiptJson: string | null;
};

export type OutboxStatusCount = {
  readonly status: CommandStatus;
  readonly count: number;
};

export type ReplicaOutboxActivity = {
  readonly statusCounts: ReadonlyArray<OutboxStatusCount>;
  readonly rejected: ReadonlyArray<OutboxActivityRow>;
  readonly caughtUpAt: number | null;
};

export const shouldRecordCaughtUp = (
  lastRecordedAtMillis: number | undefined,
  nowMillis: number,
): boolean =>
  lastRecordedAtMillis === undefined ||
  nowMillis - lastRecordedAtMillis >= CAUGHT_UP_RECORD_INTERVAL_MILLIS;
