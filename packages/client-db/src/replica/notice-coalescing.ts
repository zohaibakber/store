import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";

import {
  accumulateNotice,
  invalidatedEntities,
  type NoticeAccumulator,
} from "./collection-notices";
import type { ReplicaCommitNotice } from "./types";

export const NOTICE_BUFFER_CAPACITY = 64;

const noticeFromAccumulator = (accumulator: NoticeAccumulator): ReplicaCommitNotice =>
  Object.assign(
    {
      workspaceToken: accumulator.workspaceToken,
      generationId: accumulator.generationId,
      localCommitVersion: accumulator.version,
      touchedEntities: invalidatedEntities(accumulator),
      touchedKeys: [...accumulator.keys.values()].flatMap((held) => [...held]),
    },
    accumulator.full ? { fullInvalidation: true } : undefined,
    accumulator.overflowed.size > 0
      ? { overflowedEntities: [...accumulator.overflowed] }
      : undefined,
  );

const coalesceNotices = (
  notices: ReadonlyArray<ReplicaCommitNotice>,
): ReplicaCommitNotice | undefined => {
  const accumulator = notices.reduce<NoticeAccumulator | undefined>(accumulateNotice, undefined);
  return accumulator === undefined ? undefined : noticeFromAccumulator(accumulator);
};

export const offerCoalescing = <E>(
  queue: Queue.Queue<ReplicaCommitNotice, E>,
  notice: ReplicaCommitNotice,
): void => {
  if (Queue.offerUnsafe(queue, notice)) return;
  const dropped = Effect.runSync(Effect.orElseSucceed(Queue.clear(queue), () => []));
  const merged = coalesceNotices([...dropped, notice]);
  if (merged !== undefined) Queue.offerUnsafe(queue, merged);
};
