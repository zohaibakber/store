import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";

import {
  accumulateNotice,
  commitNotice,
  invalidatedEntities,
  type NoticeAccumulator,
} from "./collection-notices";
import type { ReplicaCommitNotice } from "./types";

export const NOTICE_BUFFER_CAPACITY = 64;

const noticeFromAccumulator = (accumulator: NoticeAccumulator): ReplicaCommitNotice =>
  commitNotice({
    workspaceToken: accumulator.workspaceToken,
    generationId: accumulator.generationId,
    localCommitVersion: accumulator.version,
    touchedEntities: invalidatedEntities(accumulator),
    touchedKeys: [...accumulator.keys.values()].flatMap((held) => [...held]),
    fullInvalidation: accumulator.full ? true : undefined,
    overflowedEntities: accumulator.overflowed.size > 0 ? [...accumulator.overflowed] : undefined,
  });

const coalesceNotices = (
  notices: ReadonlyArray<ReplicaCommitNotice>,
): ReplicaCommitNotice | undefined => {
  const accumulator = notices.reduce<NoticeAccumulator | undefined>(accumulateNotice, undefined);
  return accumulator === undefined ? undefined : noticeFromAccumulator(accumulator);
};

export const offerCoalescing = <E>(
  queue: Queue.Queue<ReplicaCommitNotice, E>,
  notice: ReplicaCommitNotice,
): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (Queue.offerUnsafe(queue, notice)) return Effect.void;
    return Queue.clear(queue).pipe(
      Effect.orElseSucceed(() => []),
      Effect.flatMap((dropped) => {
        const merged = coalesceNotices([...dropped, notice]);
        return merged === undefined ? Effect.void : Effect.asVoid(Queue.offer(queue, merged));
      }),
    );
  });
