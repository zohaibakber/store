import type { SyncEntity, SyncEntityChange } from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { ReplicaEntityRowImage } from "./projection";
import { decodeRowOrDie } from "./row-decoders";
import type { ReplicaDb } from "./sql-client/drizzle";

type EntityTable = (typeof syncEntityRows)[SyncEntity]["table"];

const inOrganization = (table: EntityTable, organizationId: string, entityId: string) =>
  and(eq(table.organizationId, organizationId), eq(table.id, entityId));

export const selectEntityRow = Effect.fnUntraced(function* (
  tx: ReplicaDb,
  organizationId: string,
  entity: SyncEntity,
  entityId: string,
) {
  const { table } = syncEntityRows[entity];
  const row = yield* tx
    .select()
    .from(table)
    .where(inOrganization(table, organizationId, entityId))
    .get();
  if (!row) return undefined;
  const decoded: ReplicaEntityRowImage = yield* decodeRowOrDie(entity, row);
  return decoded;
});

export const writeEntityRow = Effect.fnUntraced(function* (
  tx: ReplicaDb,
  entity: SyncEntity,
  row: SyncEntityChange["row"],
) {
  const { table } = syncEntityRows[entity];
  const parsed = yield* decodeRowOrDie(entity, row);
  yield* tx
    .insert(table)
    .values(parsed)
    .onConflictDoUpdate({ target: [table.organizationId, table.id], set: parsed });
});

export const removeEntityRow = Effect.fnUntraced(function* (
  tx: ReplicaDb,
  organizationId: string,
  entity: SyncEntity,
  entityId: string,
) {
  const { table } = syncEntityRows[entity];
  yield* tx.delete(table).where(inOrganization(table, organizationId, entityId));
});
