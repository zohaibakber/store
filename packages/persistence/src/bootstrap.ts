import type { SyncEntityChange } from "@store/contracts";
import { categories, syncState } from "@store/db/local/schema";
import * as Effect from "effect/Effect";

import type { MutationContext } from "./config";
import type { StoreDatabase } from "./database";
import { mapPersistenceError } from "./errors";
import { enqueueOperation } from "./outbox";

const defaultCategories = [
  { id: "general", name: "General" },
  { id: "medicine", name: "Medicine" },
  { id: "cosmetics", name: "Cosmetics" },
];

export const initializeDatabase = (database: StoreDatabase, actor: MutationContext) =>
  database
    .transaction((transaction) =>
      Effect.gen(function* () {
        const occurredAt = Date.now();
        const operationId = `bootstrap:${actor.organizationId}:categories:v1`;
        yield* transaction
          .insert(categories)
          .values(
            defaultCategories.map(({ id, name }) => ({
              id,
              name,
              organizationId: actor.organizationId,
              createdByUserId: actor.userId,
              updatedByUserId: actor.userId,
              deviceId: actor.deviceId,
              operationId,
              rowVersion: 1,
              createdAt: occurredAt,
              updatedAt: occurredAt,
            })),
          )
          .onConflictDoNothing();
        yield* transaction
          .insert(syncState)
          .values({ organizationId: actor.organizationId, cursor: 0 })
          .onConflictDoNothing();

        const existing = yield* transaction.query.syncOutbox.findFirst({
          where: { operationId },
        });
        if (existing) return;
        const rows = yield* transaction.query.categories.findMany({
          where: { organizationId: actor.organizationId },
          orderBy: { id: "asc" },
        });
        const changes: ReadonlyArray<SyncEntityChange> = rows.map((row) => ({
          entity: "category",
          action: "upsert",
          entityId: row.id,
          rowVersion: row.rowVersion,
          row,
        }));
        yield* enqueueOperation(transaction, actor, operationId, occurredAt, changes);
      }),
    )
    .pipe(mapPersistenceError("initialize local database"));
