import * as Schema from "effect/Schema";

import { SyncEntity } from "../sync/schema";

export const Stamp = Schema.Struct({
  generationId: Schema.NonEmptyString,
  localCommitVersion: Schema.Natural,
});
export type Stamp = typeof Stamp.Type;

export const ReplicaKey = Schema.NonEmptyString.pipe(Schema.brand("ReplicaKey"));
export type ReplicaKey = typeof ReplicaKey.Type;

const keyOf = Schema.decodeUnknownSync(ReplicaKey);

export const FULL_INVALIDATION_KEY = keyOf("*");

export const INSIGHTS_KEY = keyOf("insights");

export const entityKey = (entity: SyncEntity): ReplicaKey => keyOf(entity);

export const rowKey = (entity: SyncEntity, id: string): ReplicaKey => keyOf(`${entity}:${id}`);

export const touchedKeysOf = (
  entity: SyncEntity,
  ids: Iterable<string>,
): ReadonlyArray<ReplicaKey> => [entityKey(entity), ...Array.from(ids, (id) => rowKey(entity, id))];

export const CommitNotice = Schema.Struct({
  stamp: Stamp,
  touchedKeys: Schema.Array(ReplicaKey),
});
export type CommitNotice = typeof CommitNotice.Type;
