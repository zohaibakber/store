import type { SyncEntity } from "@store/contracts";
import type { ReplicaCommitNotice, ReplicaReadStamp } from "@store/contracts/sync/replica-model";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
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

type ReplicaCommitHub = {
  readonly publish: (notice: ReplicaCommitNotice | undefined) => Effect.Effect<void>;
  readonly commits: Stream.Stream<ReplicaCommitNotice>;
};

export const makeReplicaCommitHub = (): Effect.Effect<ReplicaCommitHub> =>
  Effect.gen(function* () {
    const hub = yield* PubSub.unbounded<ReplicaCommitNotice>();
    return {
      publish: (notice) => (notice ? PubSub.publish(hub, notice) : Effect.void),
      commits: Stream.fromPubSub(hub),
    } satisfies ReplicaCommitHub;
  });

export type TouchedSet = {
  readonly touchedEntities: ReadonlyArray<SyncEntity>;
  readonly touchedKeys: ReadonlyArray<string>;
};

export const EMPTY_TOUCHED: TouchedSet = { touchedEntities: [], touchedKeys: [] };

const stockKey = (batchId: string): string => `batch:${batchId}`;

export const mergeTouched = (...parts: ReadonlyArray<TouchedSet>): TouchedSet => ({
  touchedEntities: [...new Set(parts.flatMap((part) => part.touchedEntities))],
  touchedKeys: [...new Set(parts.flatMap((part) => part.touchedKeys))],
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
