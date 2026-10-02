import type { ReplicaCommitNotice as StoreCommitNotice } from "@store/contracts/sync/replica-model";
import { ReplicaStore } from "@store/sync";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { commitNotice } from "./collection-notices";
import type { ReplicaCommitPublisher } from "./publisher";
import type { ReplicaCommitNotice } from "./types";

const toClientNotice = (workspaceToken: string, notice: StoreCommitNotice): ReplicaCommitNotice =>
  commitNotice({
    workspaceToken,
    generationId: notice.generationId,
    localCommitVersion: notice.localCommitVersion,
    touchedEntities: notice.touchedEntities,
    touchedKeys: [...notice.touchedKeys],
    fullInvalidation: notice.fullInvalidation,
    overflowedEntities:
      notice.overflowedEntities === undefined ? undefined : [...notice.overflowedEntities],
  });

export const layerCommitForwarding = (
  workspaceToken: string,
  publisher: ReplicaCommitPublisher,
): Layer.Layer<never, never, ReplicaStore> =>
  Layer.effectDiscard(
    ReplicaStore.use((store) =>
      store.commits.pipe(
        Stream.runForEach((notice) =>
          Effect.sync(() => publisher.publish(toClientNotice(workspaceToken, notice))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      ),
    ),
  );
