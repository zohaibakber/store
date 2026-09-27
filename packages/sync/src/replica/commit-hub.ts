import type { SyncEntity } from "@store/contracts";
import type { ReplicaCommitNotice, ReplicaReadStamp } from "@store/contracts/sync/replica-model";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

export const touchedEntitiesWithStock = (
  entities: ReadonlyArray<SyncEntity> | undefined,
): ReadonlyArray<SyncEntity> => [...new Set<SyncEntity>(["batch", ...(entities ?? [])])];

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
  commandStatuses?: ReplicaCommitNotice["commandStatuses"],
): ReplicaCommitNotice => {
  const notice: ReplicaCommitNotice = {
    databaseIdentity,
    generationId: stamp.generationId,
    localCommitVersion: stamp.localCommitVersion,
    touchedEntities,
    touchedKeys,
  };
  if (commandStatuses !== undefined) {
    return { ...notice, commandStatuses };
  }
  return notice;
};

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
