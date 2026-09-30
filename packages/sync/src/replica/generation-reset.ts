import type { ReplicaCommitNotice, ReplicaReadStamp } from "@store/contracts/sync/replica-model";

import { noticeFromState } from "./commit-hub";
import { SYNC_ENTITIES } from "./decisions";

export const generationResetNotice = (
  databaseIdentity: string,
  after: ReplicaReadStamp,
): ReplicaCommitNotice => ({
  ...noticeFromState(databaseIdentity, after, SYNC_ENTITIES),
  fullInvalidation: true,
  overflowedEntities: SYNC_ENTITIES,
});
