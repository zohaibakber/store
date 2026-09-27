import { SyncEntity, type SyncCommandEnvelope, type SyncEntityChange } from "@store/contracts";
import { replicaEntitySchemas } from "@store/contracts/sync/replica-model";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { decodeEntity, decodeRowJson, decodeStoredEnvelope, encodeRowJson } from "../codecs";
import {
  byClientSequence,
  byEntityDependency,
  decideJournalRestore,
  freeCategoryName,
  OUTSTANDING_COMMAND_STATUSES,
  type JournalHolder,
} from "../decisions";
import {
  projectCommand,
  type CommandProjection,
  type PendingRestoreResult,
  type ProjectedRow,
  type ProjectionActor,
  type ReplicaCatalogLookup,
  type ReplicaEntityRowImage,
} from "../projection";
import { generationBounds } from "./query";
import { outboxWithStatus, type PendingRowJournalEntry, type ReplicaQueryBuilder } from "./schema";

const firstImage = <A extends { readonly generation: number }>(
  rows: ReadonlyArray<A>,
): Omit<A, "generation"> | undefined => {
  const [row] = rows;
  if (!row) return undefined;
  const { generation: _generation, ...rest } = row;
  return rest;
};

const selectEntityRow = (
  api: ReplicaQueryBuilder,
  generation: number,
  entity: SyncEntity,
  entityId: string,
): Effect.Effect<ReplicaEntityRowImage | undefined, unknown> => {
  const key: [number, string] = [generation, entityId];
  switch (entity) {
    case "category":
      return api.from("categories").select().equals(key).pipe(Effect.map(firstImage));
    case "product":
      return api.from("products").select().equals(key).pipe(Effect.map(firstImage));
    case "batch":
      return api.from("batches").select().equals(key).pipe(Effect.map(firstImage));
    case "invoice":
      return api.from("invoices").select().equals(key).pipe(Effect.map(firstImage));
    case "invoiceItem":
      return api.from("invoice_items").select().equals(key).pipe(Effect.map(firstImage));
    case "stockMovement":
      return api.from("stock_movements").select().equals(key).pipe(Effect.map(firstImage));
    default: {
      const _exhaustive: never = entity;
      return Effect.die(_exhaustive);
    }
  }
};

export const writeEntityRow = (
  api: ReplicaQueryBuilder,
  generation: number,
  entity: SyncEntity,
  row: SyncEntityChange["row"],
): Effect.Effect<unknown, unknown> => {
  switch (entity) {
    case "category":
      return api.from("categories").upsert({
        generation,
        ...Schema.decodeUnknownSync(replicaEntitySchemas.category)(row),
      });
    case "product":
      return api.from("products").upsert({
        generation,
        ...Schema.decodeUnknownSync(replicaEntitySchemas.product)(row),
      });
    case "batch":
      return api.from("batches").upsert({
        generation,
        ...Schema.decodeUnknownSync(replicaEntitySchemas.batch)(row),
      });
    case "invoice":
      return api.from("invoices").upsert({
        generation,
        ...Schema.decodeUnknownSync(replicaEntitySchemas.invoice)(row),
      });
    case "invoiceItem":
      return api.from("invoice_items").upsert({
        generation,
        ...Schema.decodeUnknownSync(replicaEntitySchemas.invoiceItem)(row),
      });
    case "stockMovement":
      return api.from("stock_movements").upsert({
        generation,
        ...Schema.decodeUnknownSync(replicaEntitySchemas.stockMovement)(row),
      });
    default: {
      const _exhaustive: never = entity;
      return Effect.die(_exhaustive);
    }
  }
};

export const removeEntityRow = (
  api: ReplicaQueryBuilder,
  generation: number,
  entity: SyncEntity,
  entityId: string,
): Effect.Effect<unknown, unknown> => {
  const key: [number, string] = [generation, entityId];
  switch (entity) {
    case "category":
      return api.from("categories").delete().equals(key);
    case "product":
      return api.from("products").delete().equals(key);
    case "batch":
      return api.from("batches").delete().equals(key);
    case "invoice":
      return api.from("invoices").delete().equals(key);
    case "invoiceItem":
      return api.from("invoice_items").delete().equals(key);
    case "stockMovement":
      return api.from("stock_movements").delete().equals(key);
    default: {
      const _exhaustive: never = entity;
      return Effect.die(_exhaustive);
    }
  }
};

export const indexedDbCatalogLookup = (
  api: ReplicaQueryBuilder,
  generation: number,
): Effect.Effect<ReplicaCatalogLookup, unknown> =>
  Effect.gen(function* () {
    const [lower, upper] = generationBounds(generation);
    const categoryRows = yield* api.from("categories").select().between(lower, upper);
    const productRows = yield* api.from("products").select().between(lower, upper);
    const batchRows = yield* api.from("batches").select().between(lower, upper);
    return {
      category: (categoryId) => categoryRows.find((row) => row.id === categoryId),
      product: (productId) => productRows.find((row) => row.id === productId),
      batch: (batchId) => batchRows.find((row) => row.id === batchId),
      productsByCategory: (categoryId) =>
        productRows.filter((row) => row.categoryId === categoryId),
      batchesByProduct: (productId) => batchRows.filter((row) => row.productId === productId),
    } satisfies ReplicaCatalogLookup;
  });

const pendingMark = (api: ReplicaQueryBuilder, entity: SyncEntity, entityId: string) =>
  api
    .from("pending_row_marks")
    .select()
    .equals([entity, entityId])
    .pipe(Effect.map((rows) => rows[0]?.operationId));

const journalEntry = (
  api: ReplicaQueryBuilder,
  operationId: string,
  projected: ProjectedRow,
  generation: number,
) =>
  Effect.gen(function* () {
    const existing = yield* api
      .from("pending_row_journal")
      .select()
      .equals([operationId, projected.entity, projected.entityId]);
    if (existing[0]) return;
    const prior = yield* selectEntityRow(api, generation, projected.entity, projected.entityId);
    yield* api.from("pending_row_journal").upsert({
      operationId,
      entity: projected.entity,
      entityId: projected.entityId,
      priorRowJson: prior ? encodeRowJson(prior) : null,
    });
  });

export const writeIndexedDbPendingProjection = (
  api: ReplicaQueryBuilder,
  generation: number,
  actor: ProjectionActor,
  lookup: ReplicaCatalogLookup,
  envelope: SyncCommandEnvelope,
  renameCollidingCategories = false,
): Effect.Effect<CommandProjection, unknown> =>
  Effect.gen(function* () {
    const projection = projectCommand(envelope, actor, lookup);
    for (const projected of projection.rows) {
      yield* journalEntry(api, envelope.operationId, projected, generation);
      if (projected.row === null) {
        yield* removeEntityRow(api, generation, projected.entity, projected.entityId);
      } else if (projected.entity === "category" && renameCollidingCategories) {
        const [lower, upper] = generationBounds(generation);
        const others = (yield* api.from("categories").select().between(lower, upper)).filter(
          (other) => other.id !== projected.row.id,
        );
        const name = others.some((other) => other.name === projected.row.name)
          ? freeCategoryName(projected.row.name, new Set(others.map((other) => other.name)))
          : projected.row.name;
        yield* writeEntityRow(api, generation, projected.entity, { ...projected.row, name });
      } else {
        yield* writeEntityRow(api, generation, projected.entity, projected.row);
      }
      yield* api.from("pending_row_marks").upsert({
        entity: projected.entity,
        entityId: projected.entityId,
        operationId: envelope.operationId,
      });
    }
    return projection;
  });

export const renumberIndexedDbCollidingInvoice = (
  api: ReplicaQueryBuilder,
  generation: number,
  incoming: { readonly id: string; readonly invoiceNumber: number },
  operationId: string,
): Effect.Effect<string | undefined, unknown> =>
  Effect.gen(function* () {
    const [lower, upper] = generationBounds(generation);
    const rows = yield* api.from("invoices").select().between(lower, upper);
    const collision = rows.find(
      (row) => row.invoiceNumber === incoming.invoiceNumber && row.id !== incoming.id,
    );
    if (!collision) return undefined;
    const mark = yield* pendingMark(api, "invoice", collision.id);
    if (mark === undefined || mark === operationId) return undefined;
    const nextNumber =
      rows.reduce((highest, row) => Math.max(highest, row.invoiceNumber), incoming.invoiceNumber) +
      1;
    yield* api.from("invoices").upsert({ ...collision, invoiceNumber: nextNumber });
    return `invoice:${collision.id}`;
  });

export const renameIndexedDbCollidingCategory = (
  api: ReplicaQueryBuilder,
  generation: number,
  incoming: { readonly id: string; readonly name: string },
  operationId: string,
): Effect.Effect<string | undefined, unknown> =>
  Effect.gen(function* () {
    const [lower, upper] = generationBounds(generation);
    const rows = yield* api.from("categories").select().between(lower, upper);
    const collision = rows.find((row) => row.name === incoming.name && row.id !== incoming.id);
    if (!collision) return undefined;
    const mark = yield* pendingMark(api, "category", collision.id);
    if (mark === undefined || mark === operationId) return undefined;
    const taken = new Set([incoming.name, ...rows.map((row) => row.name)]);
    yield* api
      .from("categories")
      .upsert({ ...collision, name: freeCategoryName(collision.name, taken) });
    return `category:${collision.id}`;
  });

export const clearIndexedDbPendingProjection = (api: ReplicaQueryBuilder, operationId: string) =>
  Effect.gen(function* () {
    yield* api.from("pending_row_marks").delete("byOperation").equals(operationId);
    yield* api.from("pending_row_journal").delete("byOperation").equals(operationId);
  });

const setIndexedDbMark = (
  api: ReplicaQueryBuilder,
  entity: SyncEntity,
  entityId: string,
  operationId: string | undefined,
) =>
  operationId === undefined
    ? api.from("pending_row_marks").delete().equals([entity, entityId])
    : api.from("pending_row_marks").upsert({ entity, entityId, operationId });

const clientSequenceOf = (api: ReplicaQueryBuilder, operationId: string) =>
  api
    .from("command_outbox")
    .select()
    .equals(operationId)
    .pipe(Effect.map((rows) => rows[0]?.clientSequence));

const journalHolders = (
  api: ReplicaQueryBuilder,
  journal: ReadonlyArray<PendingRowJournalEntry>,
  entity: SyncEntity,
  entityId: string,
  excludedOperationId: string,
): Effect.Effect<ReadonlyArray<JournalHolder>, unknown> =>
  Effect.gen(function* () {
    const holders: Array<JournalHolder> = [];
    for (const entry of journal) {
      if (entry.entity !== entity || entry.entityId !== entityId) continue;
      if (entry.operationId === excludedOperationId) continue;
      const clientSequence = yield* clientSequenceOf(api, entry.operationId);
      if (clientSequence !== undefined) {
        holders.push({ operationId: entry.operationId, clientSequence });
      }
    }
    return holders;
  });

export const restoreIndexedDbPendingProjection = (
  api: ReplicaQueryBuilder,
  generation: number,
  operationId: string,
): Effect.Effect<PendingRestoreResult, unknown> =>
  Effect.gen(function* () {
    const rejected = {
      operationId,
      clientSequence: (yield* clientSequenceOf(api, operationId)) ?? "0",
    };
    const journal = yield* api.from("pending_row_journal").select();
    const touchedEntities = new Set<SyncEntity>();
    const touchedKeys: Array<string> = [];
    const ordered = Array.sort(
      journal
        .filter((entry) => entry.operationId === operationId)
        .map((entry) => ({
          entity: decodeEntity(entry.entity),
          entityId: entry.entityId,
          priorRowJson: entry.priorRowJson,
        })),
      byEntityDependency,
    );
    const restores: Array<{
      readonly entity: SyncEntity;
      readonly entityId: string;
      readonly priorRowJson: string | null;
      readonly nextMark: string | undefined;
    }> = [];
    for (const entry of ordered) {
      const mark = yield* pendingMark(api, entry.entity, entry.entityId);
      const others = yield* journalHolders(api, journal, entry.entity, entry.entityId, operationId);
      const decision = decideJournalRestore(rejected, mark, others);
      if (decision._tag === "handDown") {
        yield* api.from("pending_row_journal").upsert({
          operationId: decision.successor,
          entity: entry.entity,
          entityId: entry.entityId,
          priorRowJson: entry.priorRowJson,
        });
      }
      if (decision._tag === "restore") restores.push({ ...entry, nextMark: decision.nextMark });
    }
    for (const entry of restores) {
      if (entry.priorRowJson === null) continue;
      yield* writeEntityRow(api, generation, entry.entity, decodeRowJson(entry.priorRowJson));
    }
    for (const entry of [...restores].reverse()) {
      if (entry.priorRowJson !== null) continue;
      yield* removeEntityRow(api, generation, entry.entity, entry.entityId);
    }
    for (const entry of restores) {
      yield* setIndexedDbMark(api, entry.entity, entry.entityId, entry.nextMark);
      touchedEntities.add(entry.entity);
      touchedKeys.push(`${entry.entity}:${entry.entityId}`);
    }
    yield* api.from("pending_row_journal").delete("byOperation").equals(operationId);
    return { touchedEntities: [...touchedEntities], touchedKeys };
  });

export const resolveIndexedDbRemoteRow = (
  api: ReplicaQueryBuilder,
  entity: SyncEntity,
  entityId: string,
) =>
  Effect.gen(function* () {
    const journal = yield* api.from("pending_row_journal").select();
    for (const entry of journal) {
      if (entry.entity !== entity || entry.entityId !== entityId) continue;
      yield* api.from("pending_row_journal").delete().equals([entry.operationId, entity, entityId]);
    }
    yield* api.from("pending_row_marks").delete().equals([entity, entityId]);
  });

export const reapplyIndexedDbPendingProjections = (
  api: ReplicaQueryBuilder,
  generation: number,
  actor: ProjectionActor,
) =>
  Effect.gen(function* () {
    yield* api.from("pending_row_marks").clear;
    yield* api.from("pending_row_journal").clear;
    const byStatus = yield* Effect.forEach(OUTSTANDING_COMMAND_STATUSES, (status) =>
      outboxWithStatus(api, status),
    );
    const outstanding = Array.sort(byStatus.flat(), byClientSequence);
    for (const row of outstanding) {
      const lookup = yield* indexedDbCatalogLookup(api, generation);
      const envelope = yield* decodeStoredEnvelope(row);
      yield* writeIndexedDbPendingProjection(api, generation, actor, lookup, envelope, true);
    }
  });
