import { SyncEntity } from "@store/contracts";
import {
  FULL_INVALIDATION_KEY,
  touchedKeysOf,
  type CommitNotice,
  type ReplicaKey,
  type Stamp,
} from "@store/contracts/replica";
import type { ReplicaCommitNotice } from "@store/contracts/sync/replica-model";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

const NOTICE_BUFFER_CAPACITY = 64;

const MAX_NOTICE_KEYS = 128;

const EVERYTHING: ReadonlyArray<ReplicaKey> = [FULL_INVALIDATION_KEY];

const isSyncEntity = Schema.is(SyncEntity);

const bounded = (keys: ReadonlyArray<ReplicaKey>): ReadonlyArray<ReplicaKey> =>
  keys.length > MAX_NOTICE_KEYS || keys.includes(FULL_INVALIDATION_KEY) ? EVERYTHING : keys;

const touchedKeysOfCommit = (notice: ReplicaCommitNotice): ReadonlyArray<ReplicaKey> => {
  if (notice.fullInvalidation === true || (notice.overflowedEntities ?? []).length > 0) {
    return EVERYTHING;
  }
  const rows = new Map<SyncEntity, Set<string>>(
    notice.touchedEntities.map((entity) => [entity, new Set<string>()]),
  );
  for (const key of notice.touchedKeys) {
    const separator = key.indexOf(":");
    const entity = key.slice(0, separator);
    if (separator < 1 || !isSyncEntity(entity)) return EVERYTHING;
    const ids = rows.get(entity) ?? new Set<string>();
    rows.set(entity, ids.add(key.slice(separator + 1)));
  }
  return bounded(Array.from(rows).flatMap(([entity, ids]) => touchedKeysOf(entity, ids)));
};

const commitNoticeOf = (notice: ReplicaCommitNotice): CommitNotice => ({
  stamp: { generationId: notice.generationId, localCommitVersion: notice.localCommitVersion },
  touchedKeys: touchedKeysOfCommit(notice),
});

const isBehind = (after: Stamp, current: Stamp): boolean =>
  after.generationId !== current.generationId ||
  after.localCommitVersion < current.localCommitVersion;

export const openingNotice = (current: Stamp, after: Stamp | undefined): CommitNotice => ({
  stamp: current,
  touchedKeys: after !== undefined && isBehind(after, current) ? EVERYTHING : [],
});

const newerStamp = (earlier: Stamp, later: Stamp): Stamp =>
  earlier.generationId === later.generationId &&
  earlier.localCommitVersion > later.localCommitVersion
    ? earlier
    : later;

const mergeNotices = (earlier: CommitNotice, later: CommitNotice): CommitNotice => ({
  stamp: newerStamp(earlier.stamp, later.stamp),
  touchedKeys: bounded([...new Set([...earlier.touchedKeys, ...later.touchedKeys])]),
});

const offerCoalescing = (
  queue: Queue.Queue<CommitNotice>,
  notice: CommitNotice,
): Effect.Effect<void> =>
  Queue.offer(queue, notice).pipe(
    Effect.flatMap((accepted) =>
      accepted
        ? Effect.void
        : Queue.clear(queue).pipe(
            Effect.flatMap((held) => Queue.offer(queue, [...held, notice].reduce(mergeNotices))),
          ),
    ),
  );

export const coalescedNotices = (
  commits: Stream.Stream<ReplicaCommitNotice>,
): Effect.Effect<Stream.Stream<CommitNotice>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const queue = yield* Queue.dropping<CommitNotice>(NOTICE_BUFFER_CAPACITY);
    yield* commits.pipe(
      Stream.runForEach((notice) => offerCoalescing(queue, commitNoticeOf(notice))),
      Effect.forkScoped({ startImmediately: true }),
    );
    return Stream.fromQueue(queue);
  });
