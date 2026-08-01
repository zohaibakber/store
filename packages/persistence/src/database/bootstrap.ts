import { syncState } from "@store/db/local/schema";
import * as Effect from "effect/Effect";

import type { Workspace } from "../config";
import { mapPersistenceError } from "../errors";
import type { StoreDatabase } from "./client";

/**
 * A workspace starts empty. Categories used to be seeded here — General,
 * Medicine, Cosmetics — but a seeded taxonomy is one nobody chose, and now that
 * a category decides how the product form behaves it has to be the shop's own.
 * They are created from Settings, or inline while adding a product.
 */
export const initializeDatabase = (database: StoreDatabase, workspace: Workspace) =>
  database
    .transaction((transaction) =>
      transaction
        .insert(syncState)
        .values({ organizationId: workspace.organizationId, cursor: 0 })
        .onConflictDoNothing(),
    )
    .pipe(Effect.asVoid, mapPersistenceError("initialize local database"));
