import type { SyncEntityChange } from "@store/contracts";
import { categories, syncState } from "@store/db/local/schema";
import * as Effect from "effect/Effect";

import type { Workspace } from "../config";
import { mapPersistenceError } from "../errors";
import { enqueueOperation } from "../sync/outbox";
import type { StoreDatabase } from "./client";

const defaultCategories = [
  { id: "general", name: "General" },
  { id: "medicine", name: "Medicine" },
  { id: "cosmetics", name: "Cosmetics" },
];

export const initializeDatabase = (database: StoreDatabase, workspace: Workspace) =>
  database
    .transaction((transaction) =>
      Effect.gen(function* () {
        const occurredAt = Date.now();
        const operationId = `bootstrap:${workspace.organizationId}:categories:v1`;
        yield* transaction
          .insert(categories)
          .values(
            defaultCategories.map(({ id, name }) => ({
              id,
              name,
              organizationId: workspace.organizationId,
              createdByUserId: workspace.userId,
              updatedByUserId: workspace.userId,
              deviceId: workspace.deviceId,
              operationId,
              rowVersion: 1,
              createdAt: occurredAt,
              updatedAt: occurredAt,
            })),
          )
          .onConflictDoNothing();
        yield* transaction
          .insert(syncState)
          .values({ organizationId: workspace.organizationId, cursor: 0 })
          .onConflictDoNothing();

        const existing = yield* transaction.query.syncOutbox.findFirst({
          where: { operationId },
        });
        if (existing) return;
        const rows = yield* transaction.query.categories.findMany({
          where: { organizationId: workspace.organizationId },
          orderBy: { id: "asc" },
        });
        const changes: ReadonlyArray<SyncEntityChange> = rows.map((row) => ({
          entity: "category",
          action: "upsert",
          entityId: row.id,
          rowVersion: row.rowVersion,
          row,
        }));
        yield* enqueueOperation(transaction, workspace, operationId, occurredAt, changes);
      }),
    )
    .pipe(mapPersistenceError("initialize local database"));
