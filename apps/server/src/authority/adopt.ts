import type { SyncEntity } from "@store/contracts";
import {
  authorityChanges,
  authorityState,
  authorityTransactions,
  catalogImport,
  commandReceipts,
  replicas,
} from "@store/db/authority.schema";
import * as pg from "@store/db/postgres/schema";
import { writeEntityRow, type ReplicaDb } from "@store/sync/authority";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import * as Array from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type { SqlClient } from "effect/sql/SqlClient";

import { sequenceOf, type AuthorityActor } from "./engine";

const CHANGE_ROWS_PER_INSERT = 12;

const ADOPTED_FROM_POSTGRES = "postgres";

const ADOPTION_FENCING = "postgres:fencing";

const FENCE_SUFFIX = "0000";

const ADOPTED_ENTITIES = [
  "category",
  "product",
  "batch",
  "invoice",
  "invoiceItem",
  "stockMovement",
  "supplier",
  "purchaseOrder",
  "purchaseOrderItem",
] as const satisfies ReadonlyArray<SyncEntity>;

const sourceRows = Effect.fnUntraced(function* (
  tx: PgReader,
  entity: SyncEntity,
  organizationId: string,
) {
  switch (entity) {
    case "category":
      return yield* tx
        .select()
        .from(pg.categories)
        .where(eq(pg.categories.organizationId, organizationId));
    case "product":
      return yield* tx
        .select()
        .from(pg.products)
        .where(and(eq(pg.products.organizationId, organizationId), isNull(pg.products.deletedAt)));
    case "batch":
      return yield* tx
        .select()
        .from(pg.batches)
        .where(and(eq(pg.batches.organizationId, organizationId), isNull(pg.batches.deletedAt)));
    case "invoice":
      return yield* tx
        .select()
        .from(pg.invoices)
        .where(eq(pg.invoices.organizationId, organizationId));
    case "invoiceItem":
      return yield* tx
        .select()
        .from(pg.invoiceItems)
        .where(eq(pg.invoiceItems.organizationId, organizationId));
    case "stockMovement":
      return yield* tx
        .select()
        .from(pg.stockMovements)
        .where(eq(pg.stockMovements.organizationId, organizationId));
    case "supplier":
      return yield* tx
        .select()
        .from(pg.suppliers)
        .where(eq(pg.suppliers.organizationId, organizationId));
    case "purchaseOrder":
      return yield* tx
        .select()
        .from(pg.purchaseOrders)
        .where(eq(pg.purchaseOrders.organizationId, organizationId));
    case "purchaseOrderItem":
      return yield* tx
        .select()
        .from(pg.purchaseOrderItems)
        .where(eq(pg.purchaseOrderItems.organizationId, organizationId));
  }
});

type PgReader = Pick<EffectPgDatabase, "select">;

export type AdoptionSource = {
  readonly adopt: (
    actor: AuthorityActor,
    sql: SqlClient,
    db: ReplicaDb,
  ) => Effect.Effect<boolean, unknown>;
  readonly fence: (organizationId: string, epoch: string) => Effect.Effect<void, unknown>;
};

export const NO_ADOPTION: AdoptionSource = {
  adopt: () => Effect.succeed(false),
  fence: () => Effect.void,
};

const fenced = (epoch: string) => `${epoch}${FENCE_SUFFIX}`;

export const settleAdoption = Effect.fn("AuthorityAdoption.settle")(function* (
  source: AdoptionSource,
  actor: AuthorityActor,
  sql: SqlClient,
  db: ReplicaDb,
) {
  const held = yield* db.select().from(authorityState).get();
  const adopted = held === undefined ? yield* source.adopt(actor, sql, db) : false;
  const state = adopted ? yield* db.select().from(authorityState).get() : held;
  if (state?.adoptedFrom === ADOPTION_FENCING) {
    yield* source.fence(state.organizationId, state.epoch);
    yield* db
      .update(authorityState)
      .set({ adoptedFrom: ADOPTED_FROM_POSTGRES })
      .where(eq(authorityState.id, state.id));
  }
  return adopted;
});

export const postgresAdoption = (source: EffectPgDatabase): AdoptionSource => ({
  fence: Effect.fn("AuthorityAdoption.fence")(function* (organizationId, epoch) {
    yield* source
      .update(pg.inventoryState)
      .set({ epoch: fenced(epoch) })
      .where(
        and(
          eq(pg.inventoryState.organizationId, organizationId),
          eq(pg.inventoryState.epoch, epoch),
        ),
      );
  }),
  adopt: Effect.fn("AuthorityAdoption.fromPostgres")(function* (actor, sql, db) {
    const organizationId = actor.organizationId;
    return yield* source.transaction((tx) =>
      Effect.gen(function* () {
        const [state] = yield* tx
          .select()
          .from(pg.inventoryState)
          .where(eq(pg.inventoryState.organizationId, organizationId))
          .for("update");
        if (state === undefined) return false;
        const now = yield* Clock.currentTimeMillis;
        const retentionFloor = sequenceOf(state.retentionFloor);

        const catalog = yield* Effect.forEach(ADOPTED_ENTITIES, (entity) =>
          Effect.map(sourceRows(tx, entity, organizationId), (rows) => ({ entity, rows })),
        );
        const knownReplicas = yield* tx
          .select()
          .from(pg.replicas)
          .where(eq(pg.replicas.organizationId, organizationId));
        const receipts = yield* tx
          .select()
          .from(pg.commandReceipts)
          .where(eq(pg.commandReceipts.organizationId, organizationId));
        const transactions = yield* tx
          .select()
          .from(pg.inventoryTransactions)
          .where(
            and(
              eq(pg.inventoryTransactions.organizationId, organizationId),
              gt(pg.inventoryTransactions.commitSequence, state.retentionFloor),
            ),
          )
          .orderBy(asc(pg.inventoryTransactions.commitSequence));
        const changes = yield* tx
          .select()
          .from(pg.inventoryChanges)
          .where(
            and(
              eq(pg.inventoryChanges.organizationId, organizationId),
              gt(pg.inventoryChanges.commitSequence, state.retentionFloor),
            ),
          )
          .orderBy(asc(pg.inventoryChanges.commitSequence), asc(pg.inventoryChanges.ordinal));
        const [imported] = yield* tx
          .select()
          .from(pg.catalogImports)
          .where(eq(pg.catalogImports.organizationId, organizationId));

        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* db.insert(authorityState).values({
              id: 1,
              organizationId,
              incarnation: state.incarnation,
              epoch: state.epoch,
              commitSequence: sequenceOf(state.commitSequence),
              retentionFloor,
              createdAt: now,
              maintainedAt: state.maintainedAt,
              adoptedFrom: ADOPTION_FENCING,
            });
            for (const { entity, rows } of catalog) {
              for (const row of rows) yield* writeEntityRow(db, entity, row);
            }
            for (const replica of knownReplicas) {
              yield* db.insert(replicas).values({
                replicaId: replica.replicaId,
                ownerUserId: replica.ownerUserId,
                deviceLabel: replica.deviceLabel,
                lastClientSequence: sequenceOf(replica.lastClientSequence),
                processedThroughClientSequence: sequenceOf(replica.processedThroughClientSequence),
                registeredAt: replica.registeredAt,
                lastSeenAt: replica.lastSeenAt,
                schemaVersion: replica.schemaVersion,
                schemaVersionAt: replica.schemaVersionAt,
                ignoredAt: replica.ignoredAt,
                removedAt: replica.removedAt,
              });
            }
            for (const receipt of receipts) {
              yield* db.insert(commandReceipts).values({
                operationId: receipt.operationId,
                replicaId: receipt.replicaId,
                clientSequence: sequenceOf(receipt.clientSequence),
                payloadHash: receipt.payloadHash,
                decision: receipt.decision,
                commitSequence: sequenceOf(receipt.commitSequence),
                resultJson: receipt.resultJson,
                receivedAt: receipt.receivedAt,
                attempts: receipt.attempts,
              });
            }
            for (const transaction of transactions) {
              const commitSequence = sequenceOf(transaction.commitSequence);
              if (commitSequence <= retentionFloor) continue;
              yield* db.insert(authorityTransactions).values({
                commitSequence,
                operationId: transaction.operationId,
                decision: transaction.decision,
                epoch: transaction.epoch,
                byteLength: transaction.byteLength,
              });
            }
            const retained = changes.flatMap((change) => {
              const commitSequence = sequenceOf(change.commitSequence);
              return commitSequence <= retentionFloor
                ? []
                : [
                    {
                      commitSequence,
                      ordinal: change.ordinal,
                      entity: change.entity,
                      action: change.action,
                      entityId: change.entityId,
                      rowVersion: change.rowVersion,
                      rowJson: change.rowJson,
                    },
                  ];
            });
            for (const chunk of Array.chunksOf(retained, CHANGE_ROWS_PER_INSERT)) {
              yield* db.insert(authorityChanges).values(chunk);
            }
            if (imported !== undefined) {
              yield* db.insert(catalogImport).values({
                id: 1,
                importId: imported.importId,
                committedByUserId: imported.committedByUserId,
                committedAt: imported.committedAt,
                resultJson: imported.resultJson,
              });
            }
          }),
        );

        yield* tx
          .update(pg.inventoryState)
          .set({ epoch: fenced(state.epoch) })
          .where(eq(pg.inventoryState.organizationId, organizationId));
        return true;
      }),
    );
  }),
});
