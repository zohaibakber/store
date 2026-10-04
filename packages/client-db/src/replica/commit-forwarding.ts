import type { ReplicaCommitNotice as StoreCommitNotice } from "@store/contracts/sync/replica-model";

import { commitNotice } from "./collection-notices";
import type { ReplicaCommitNotice } from "./types";

export const toClientNotice = (
  workspaceToken: string,
  notice: StoreCommitNotice,
): ReplicaCommitNotice =>
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
