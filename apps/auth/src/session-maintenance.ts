import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import type { AuthRepositoryApi } from "./repository";

export const SESSION_PRUNE_POLICY = {
  cronExpression: "23 * * * *",
  retainAfterExpiryMillis: 7 * 24 * 60 * 60 * 1_000,
  batchRows: 500,
  maxBatches: 20,
} as const;

export type SessionPrunePolicy = {
  readonly retainAfterExpiryMillis: number;
  readonly batchRows: number;
  readonly maxBatches: number;
};

export type SessionPruneProgress = {
  readonly deleted: number;
  readonly batches: number;
  readonly more: boolean;
};

export const pruneExpiredSessions = Effect.fn("AuthMaintenance.pruneExpiredSessions")(function* (
  repository: AuthRepositoryApi,
  policy: SessionPrunePolicy = SESSION_PRUNE_POLICY,
) {
  const now = yield* Clock.currentTimeMillis;
  const expiredBefore = now - policy.retainAfterExpiryMillis;
  let deleted = 0;
  let batches = 0;
  while (batches < policy.maxBatches) {
    const pruned = yield* repository.pruneExpiredSessions({
      expiredBefore,
      limit: policy.batchRows,
    });
    deleted += pruned;
    batches += 1;
    if (pruned < policy.batchRows) {
      return { deleted, batches, more: false } satisfies SessionPruneProgress;
    }
  }
  return { deleted, batches, more: true } satisfies SessionPruneProgress;
});
