import type { EnqueueCommandRequest, SyncCommandEnvelope } from "@store/contracts";

export const enqueueRequestOf = (
  envelope: SyncCommandEnvelope,
  occurredAt: number,
): EnqueueCommandRequest => ({
  operationId: envelope.operationId,
  command: envelope.command,
  occurredAt,
});
