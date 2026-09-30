import { SyncEntity } from "@store/contracts";
import * as Schema from "effect/Schema";

import { SOURCE_ENTITY } from "./sources";
import type { ReplicaCommitNotice } from "./types";

export const NOTICE_KEYS_PER_ENTITY = 128;

const ALL_ENTITIES: ReadonlyArray<SyncEntity> = Object.values(SOURCE_ENTITY);

const isSyncEntity = Schema.is(SyncEntity);

export type NoticeAccumulator = {
  readonly workspaceToken: string;
  readonly generationId: string;
  readonly version: number;
  readonly full: boolean;
  readonly entities: ReadonlySet<SyncEntity>;
  readonly keys: ReadonlyMap<SyncEntity, ReadonlySet<string>>;
  readonly overflowed: ReadonlySet<SyncEntity>;
};

const overflowedEntitiesOf = (notice: ReplicaCommitNotice): ReadonlyArray<SyncEntity> =>
  notice.overflowedEntities ?? [];

const keyEntity = (key: string): SyncEntity | undefined => {
  const separator = key.indexOf(":");
  if (separator <= 0) return undefined;
  const entity = key.slice(0, separator);
  return isSyncEntity(entity) ? entity : undefined;
};

export const noticeAffects = (notice: ReplicaCommitNotice, entity: SyncEntity): boolean =>
  notice.fullInvalidation === true ||
  notice.touchedEntities.includes(entity) ||
  overflowedEntitiesOf(notice).includes(entity) ||
  notice.touchedKeys.some((key) => keyEntity(key) === entity);

export const invalidatedEntities = (accumulator: NoticeAccumulator): ReadonlyArray<SyncEntity> =>
  accumulator.full
    ? ALL_ENTITIES
    : ALL_ENTITIES.filter(
        (entity) => accumulator.entities.has(entity) || accumulator.overflowed.has(entity),
      );

const withKey = (
  keys: Map<SyncEntity, Set<string>>,
  overflowed: Set<SyncEntity>,
  entity: SyncEntity,
  key: string,
): void => {
  if (overflowed.has(entity)) return;
  const held = keys.get(entity) ?? new Set<string>();
  held.add(key);
  if (held.size > NOTICE_KEYS_PER_ENTITY) {
    keys.delete(entity);
    overflowed.add(entity);
    return;
  }
  keys.set(entity, held);
};

const unionInto = (
  entities: Set<SyncEntity>,
  keys: Map<SyncEntity, Set<string>>,
  overflowed: Set<SyncEntity>,
  more: {
    readonly entities: Iterable<SyncEntity>;
    readonly keys: Iterable<readonly [SyncEntity, Iterable<string>]>;
    readonly overflowed: Iterable<SyncEntity>;
  },
): void => {
  for (const entity of more.entities) entities.add(entity);
  for (const entity of more.overflowed) {
    entities.add(entity);
    overflowed.add(entity);
    keys.delete(entity);
  }
  for (const [entity, entityKeys] of more.keys) {
    entities.add(entity);
    for (const key of entityKeys) withKey(keys, overflowed, entity, key);
  }
};

const copyOf = (accumulator: NoticeAccumulator) => ({
  entities: new Set(accumulator.entities),
  keys: new Map(
    Array.from(accumulator.keys, ([entity, held]): [SyncEntity, Set<string>] => [
      entity,
      new Set(held),
    ]),
  ),
  overflowed: new Set(accumulator.overflowed),
});

export const accumulateNotice = (
  accumulator: NoticeAccumulator | undefined,
  notice: ReplicaCommitNotice,
): NoticeAccumulator => {
  const sameToken =
    accumulator !== undefined && accumulator.workspaceToken === notice.workspaceToken;
  const sameStream = sameToken && accumulator.generationId === notice.generationId;
  if (sameStream && notice.localCommitVersion <= accumulator.version) return accumulator;
  const base = sameStream ? copyOf(accumulator) : undefined;
  const entities = base?.entities ?? new Set<SyncEntity>();
  const keys = base?.keys ?? new Map<SyncEntity, Set<string>>();
  const overflowed = base?.overflowed ?? new Set<SyncEntity>();
  const noticeKeys = new Map<SyncEntity, Array<string>>();
  for (const key of notice.touchedKeys) {
    const entity = keyEntity(key);
    if (entity === undefined) continue;
    noticeKeys.set(entity, [...(noticeKeys.get(entity) ?? []), key]);
  }
  unionInto(entities, keys, overflowed, {
    entities: notice.touchedEntities,
    keys: noticeKeys,
    overflowed: overflowedEntitiesOf(notice),
  });
  return {
    workspaceToken: notice.workspaceToken,
    generationId: notice.generationId,
    version: notice.localCommitVersion,
    full:
      notice.fullInvalidation === true ||
      (sameToken && !sameStream) ||
      (sameStream && accumulator.full),
    entities,
    keys,
    overflowed,
  };
};

export const invalidateEverything = (
  accumulator: NoticeAccumulator | undefined,
  stamp: {
    readonly workspaceToken: string;
    readonly generationId: string;
    readonly localCommitVersion: number;
  },
): NoticeAccumulator => ({
  workspaceToken: stamp.workspaceToken,
  generationId: stamp.generationId,
  version: Math.max(stamp.localCommitVersion, accumulator?.version ?? 0),
  full: true,
  entities: new Set(),
  keys: new Map(),
  overflowed: new Set(),
});

export const mergeAccumulators = (
  earlier: NoticeAccumulator,
  later: NoticeAccumulator | undefined,
): NoticeAccumulator => {
  if (later === undefined) return earlier;
  if (later.workspaceToken !== earlier.workspaceToken) return later;
  const merged = copyOf(earlier);
  unionInto(merged.entities, merged.keys, merged.overflowed, later);
  return {
    workspaceToken: later.workspaceToken,
    generationId: later.generationId,
    version: Math.max(earlier.version, later.version),
    full: earlier.full || later.full || earlier.generationId !== later.generationId,
    ...merged,
  };
};
