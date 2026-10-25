import type { SyncEntity } from "@store/contracts";
import type { ReplicaCommitNotice, ReplicaReadStamp } from "@store/contracts/sync/replica-model";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { SYNC_ENTITIES } from "./decisions";

export const stampOf = (state: {
  readonly activeGeneration: number;
  readonly localCommitVersion: number;
}): ReplicaReadStamp => ({
  generationId: String(state.activeGeneration),
  localCommitVersion: state.localCommitVersion,
});

export const noticeFromState = (
  databaseIdentity: string,
  stamp: ReplicaReadStamp,
  touchedEntities: ReplicaCommitNotice["touchedEntities"] = [],
  touchedKeys: ReadonlyArray<string> = [],
): ReplicaCommitNotice => ({
  databaseIdentity,
  generationId: stamp.generationId,
  localCommitVersion: stamp.localCommitVersion,
  touchedEntities,
  touchedKeys,
});

export const generationResetNotice = (
  databaseIdentity: string,
  after: ReplicaReadStamp,
): ReplicaCommitNotice => ({
  ...noticeFromState(databaseIdentity, after, SYNC_ENTITIES),
  fullInvalidation: true,
  overflowedEntities: SYNC_ENTITIES,
});

type ReplicaCommitHub = {
  readonly publish: (notice: ReplicaCommitNotice | undefined) => Effect.Effect<void>;
  readonly commits: Stream.Stream<ReplicaCommitNotice>;
};

type SequencedNotice = { readonly sequence: number; readonly notice: ReplicaCommitNotice };

export const COMMIT_HUB_CAPACITY = 256;

const withoutGaps = (
  subscription: PubSub.Subscription<SequencedNotice>,
  baseline: number,
): Stream.Stream<ReplicaCommitNotice> =>
  Stream.fromSubscription(subscription).pipe(
    Stream.mapAccum(
      () => baseline,
      (last, { sequence, notice }): readonly [number, ReadonlyArray<ReplicaCommitNotice>] => {
        if (sequence <= last) return [last, []];
        const missed = sequence > last + 1;
        return [
          sequence,
          missed
            ? [
                generationResetNotice(notice.databaseIdentity, {
                  generationId: notice.generationId,
                  localCommitVersion: notice.localCommitVersion,
                }),
                notice,
              ]
            : [notice],
        ];
      },
    ),
  );

export const makeReplicaCommitHub = (): Effect.Effect<ReplicaCommitHub> =>
  Effect.gen(function* () {
    const hub = yield* PubSub.sliding<SequencedNotice>(COMMIT_HUB_CAPACITY);
    const publishing = yield* Semaphore.make(1);
    const sequence = yield* Ref.make(0);
    return {
      publish: (notice) =>
        notice
          ? publishing.withPermits(1)(
              Ref.updateAndGet(sequence, (last) => last + 1).pipe(
                Effect.flatMap((next) => PubSub.publish(hub, { sequence: next, notice })),
              ),
            )
          : Effect.void,
      commits: Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(hub);
          return withoutGaps(subscription, yield* Ref.get(sequence));
        }),
      ),
    } satisfies ReplicaCommitHub;
  });

export type TouchedSet = {
  readonly touchedEntities: ReadonlyArray<SyncEntity>;
  readonly touchedKeys: ReadonlyArray<string>;
};

export const EMPTY_TOUCHED: TouchedSet = { touchedEntities: [], touchedKeys: [] };

const stockKey = (batchId: string): string => `batch:${batchId}`;

export const mergeTouched = (...parts: ReadonlyArray<TouchedSet>): TouchedSet => ({
  touchedEntities: Array.dedupe(parts.flatMap((part) => part.touchedEntities)),
  touchedKeys: Array.dedupe(parts.flatMap((part) => part.touchedKeys)),
});

export const withStockTouched = (
  touched: TouchedSet,
  batchIds: ReadonlyArray<string>,
): TouchedSet =>
  batchIds.length === 0
    ? touched
    : mergeTouched(touched, {
        touchedEntities: ["batch"],
        touchedKeys: batchIds.map(stockKey),
      });

export const touchedOfChange = (entity: SyncEntity, entityId: string): TouchedSet => ({
  touchedEntities: [entity],
  touchedKeys: [`${entity}:${entityId}`],
});

export const touchedOfKey = (key: string): TouchedSet => {
  const separator = key.indexOf(":");
  const entity = SYNC_ENTITIES.find((name) => name === key.slice(0, separator));
  return { touchedEntities: entity === undefined ? [] : [entity], touchedKeys: [key] };
};
