import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import type { AuthRepository } from "./repository";

export const SESSION_PRUNE_POLICY = {
  cronExpression: "23 * * * *",
  retainAfterExpiryMillis: 7 * 24 * 60 * 60 * 1_000,
  batchRows: 500,
  maxBatches: 20,
} as const;

type SessionPrunePolicy = {
  readonly retainAfterExpiryMillis: number;
  readonly batchRows: number;
  readonly maxBatches: number;
};

type SessionPruneProgress = {
  readonly deleted: number;
  readonly batches: number;
  readonly more: boolean;
};

export const pruneExpiredSessions = Effect.fn("AuthMaintenance.pruneExpiredSessions")(function* (
  repository: AuthRepository["Service"],
  policy: SessionPrunePolicy = SESSION_PRUNE_POLICY,
) {
  const now = yield* Clock.currentTimeMillis;
  const expiredBefore = now - policy.retainAfterExpiryMillis;
  const progress = yield* Ref.make({ deleted: 0, batches: 0 });
  const lastBatch = yield* repository
    .pruneExpiredSessions({ expiredBefore, limit: policy.batchRows })
    .pipe(
      Effect.tap((pruned) =>
        Ref.update(progress, ({ deleted, batches }) => ({
          deleted: deleted + pruned,
          batches: batches + 1,
        })),
      ),
      Effect.repeat({
        while: (pruned) => pruned >= policy.batchRows,
        times: policy.maxBatches - 1,
      }),
    );
  return {
    ...(yield* Ref.get(progress)),
    more: lastBatch >= policy.batchRows,
  } satisfies SessionPruneProgress;
});
