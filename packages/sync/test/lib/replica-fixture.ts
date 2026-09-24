import type { SyncCommandEnvelope } from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
} from "@store/contracts/sync/fixtures";
import { batches, categories, products, replicaState } from "@store/db/replica.schema";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import {
  openReplicaStore,
  runReplicaTransaction,
  type SqliteReplicaHandle,
} from "../../src/replica/storage";

export const FIXTURE_USER_ID = "user-1";

export const FIXTURE_CATEGORY_ID = "general";

export const FIXTURE_OCCURRED_AT = 1_700_000_000_000;

export const seedReplicaTenUnits = (path?: string) =>
  Effect.gen(function* () {
    const store = yield* openReplicaStore(path);
    yield* runReplicaTransaction(store, (tx) =>
      Effect.gen(function* () {
        yield* tx.insert(replicaState).values({
          id: "singleton",
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          userId: FIXTURE_USER_ID,
          replicaId: LAST_UNIT_REPLICA_A,
          epoch: LAST_UNIT_EPOCH,
          incarnation: "incarnation-test",
          appliedCommitSequence: "0",
          nextClientSequence: "1",
          localCommitVersion: 0,
        });
        yield* tx.insert(categories).values({
          id: FIXTURE_CATEGORY_ID,
          name: "General",
          tracksPacks: true,
          createdAt: FIXTURE_OCCURRED_AT,
          updatedAt: FIXTURE_OCCURRED_AT,
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          createdByUserId: FIXTURE_USER_ID,
          updatedByUserId: FIXTURE_USER_ID,
          deviceId: LAST_UNIT_REPLICA_A,
          operationId: "seed-category",
          rowVersion: 1,
        });
        yield* tx.insert(products).values({
          id: LAST_UNIT_PRODUCT_ID,
          name: "Ten pack",
          categoryId: FIXTURE_CATEGORY_ID,
          aisle: null,
          composition: null,
          strength: null,
          unitsPerPack: 1,
          purchasePrice: 50,
          retailPrice: 100,
          unitPrice: 100,
          visible: true,
          createdAt: FIXTURE_OCCURRED_AT,
          updatedAt: FIXTURE_OCCURRED_AT,
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          createdByUserId: FIXTURE_USER_ID,
          updatedByUserId: FIXTURE_USER_ID,
          deviceId: LAST_UNIT_REPLICA_A,
          operationId: "seed-product",
          rowVersion: 1,
        });
        yield* tx.insert(batches).values({
          id: LAST_UNIT_BATCH_ID,
          productId: LAST_UNIT_PRODUCT_ID,
          batchNumber: "B-1",
          expiresAt: null,
          packQuantity: 0,
          unitQuantity: 10,
          createdAt: FIXTURE_OCCURRED_AT,
          updatedAt: FIXTURE_OCCURRED_AT,
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          createdByUserId: FIXTURE_USER_ID,
          updatedByUserId: FIXTURE_USER_ID,
          deviceId: LAST_UNIT_REPLICA_A,
          operationId: "seed-batch",
          rowVersion: 1,
        });
      }),
    ).pipe(Effect.orDie);
    return store;
  });

export const withSeededReplica = <A, E, R>(
  use: (store: SqliteReplicaHandle) => Effect.Effect<A, E, R>,
  path?: string,
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> =>
  Effect.scoped(Effect.flatMap(seedReplicaTenUnits(path), use));

export const invoiceCommandOf = (
  envelope: SyncCommandEnvelope,
): Extract<SyncCommandEnvelope["command"], { readonly _tag: "issueInvoice" }> => {
  if (envelope.command._tag !== "issueInvoice") {
    throw new Error("The envelope does not carry an invoice command.");
  }
  return envelope.command;
};

export const invoicePayloadOf = (envelope: SyncCommandEnvelope) =>
  invoiceCommandOf(envelope).payload;
