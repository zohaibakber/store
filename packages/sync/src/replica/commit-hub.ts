import type { ReplicaCommitNotice, ReplicaReadStamp } from "@store/contracts/sync/replica-model";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

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

export type ReplicaCommitHub = {
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
