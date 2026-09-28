import { syncProtocolError, type SyncProtocolError } from "@store/contracts";
import { inventoryState, replicas } from "@store/db/postgres/schema";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { InventoryDrizzle } from "../../../src/inventory/postgres";

export type InventoryTransaction = Parameters<Parameters<InventoryDrizzle["transaction"]>[0]>[0];

export const protocol = (code: SyncProtocolError["code"], message: string) =>
  Effect.fail(syncProtocolError(code, message));

export const lockOrganization = Effect.fn("Oracle.lockOrganization")(function* (
  tx: InventoryTransaction,
  organizationId: string,
) {
  const [state] = yield* tx
    .select()
    .from(inventoryState)
    .where(eq(inventoryState.organizationId, organizationId))
    .for("update")
    .limit(1);
  return state && state.status === "ready" && state.releaseId !== null
    ? state
    : yield* protocol("EPOCH_MISMATCH", "This organization inventory is not ready.");
});

export const readReplica = (tx: InventoryTransaction, organizationId: string, replicaId: string) =>
  tx
    .select()
    .from(replicas)
    .where(and(eq(replicas.organizationId, organizationId), eq(replicas.replicaId, replicaId)))
    .limit(1)
    .pipe(Effect.map(([replica]) => replica));
