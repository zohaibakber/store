import { type SyncCommandEnvelope, type SyncEntity, type SyncEntityChange } from "@store/contracts";
import type { SyncCommand } from "@store/contracts";
import { replicaEntitySchemas } from "@store/contracts/sync/replica-model";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { decodeEntity, decodeRowJson, decodeStoredEnvelope, encodeRowJson } from "../codecs";
import { nextFreeCategoryName } from "../collisions";
import {
  byClientSequence,
  byEntityDependency,
  decideJournalRestore,
  EMPTY_STOCK,
  freeInvoiceNumber,
  OUTSTANDING_COMMAND_STATUSES,
  type JournalHolder,
  type VisibleStock,
} from "../decisions";
import { loadCatalog, type CatalogReads } from "../footprint";
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
import { outboxWithStatus, productImage, storedProduct, type ReplicaQueryBuilder } from "./schema";
import { readVisibleStock } from "./stock";

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
      return api
        .from("products")
        .select()
        .equals(key)
        .pipe(Effect.map((rows) => (rows[0] ? productImage(rows[0]) : undefined)));
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
      return api
        .from("products")
        .upsert(
          storedProduct(generation, Schema.decodeUnknownSync(replicaEntitySchemas.product)(row)),
        );
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

const isStocked = (batch: { readonly packQuantity: number; readonly unitQuantity: number }) =>
  batch.packQuantity > 0 || batch.unitQuantity > 0;

const definedImages = <A>(images: ReadonlyArray<A | undefined>): ReadonlyArray<A> =>
  images.flatMap((image) => (image === undefined ? [] : [image]));

const indexedDbCatalogReads = (
  api: ReplicaQueryBuilder,
  generation: number,
): CatalogReads<unknown, never> => ({
  rowsOf: (footprint) =>
    Effect.gen(function* () {
      const categoryRows = yield* Effect.forEach(footprint.categoryIds, (id) =>
        api.from("categories").select().equals([generation, id]).pipe(Effect.map(firstImage)),
      );
      const productRows = yield* Effect.forEach(footprint.productIds, (id) =>
        api
          .from("products")
          .select()
          .equals([generation, id])
          .pipe(Effect.map((rows) => (rows[0] ? productImage(rows[0]) : undefined))),
      );
      const batchRows = yield* Effect.forEach(footprint.batchIds, (id) =>
        api.from("batches").select().equals([generation, id]).pipe(Effect.map(firstImage)),
      );
      return {
        categories: definedImages(categoryRows),
        products: definedImages(productRows),
        batches: definedImages(batchRows),
      };
    }),
  productInCategory: (categoryId) =>
    api
      .from("products")
      .select("byCategory")
      .equals([generation, categoryId])
      .limit(1)
      .pipe(Effect.map((rows) => (rows[0] ? { categoryId } : undefined))),
  stockedBatchOfProduct: (productId) =>
    api
      .from("batches")
      .select("byProduct")
      .equals([generation, productId])
      .pipe(Effect.map((rows) => firstImage(rows.filter(isStocked)))),
});

export const readIndexedDbCommandContext = (
  api: ReplicaQueryBuilder,
  generation: number,
  command: SyncCommand,
  options: { readonly checkRules: boolean; readonly withStock: boolean },
) =>
  Effect.gen(function* () {
    const { rows, lookup } = yield* loadCatalog(command, indexedDbCatalogReads(api, generation), {
      checkRules: options.checkRules,
    });
    const stock = options.withStock
      ? yield* readVisibleStock(api, rows.batches)
      : new Map<string, VisibleStock>();
    return {
      lookup,
      unitsPerPackFor: (productId: string) => lookup.product(productId)?.unitsPerPack ?? 1,
      stockFor: (batchId: string) => stock.get(batchId) ?? EMPTY_STOCK,
    };
  });

export const readIndexedDbUnitsPerPack = (
  api: ReplicaQueryBuilder,
  generation: number,
  productIds: ReadonlyArray<string>,
): Effect.Effect<(productId: string) => number, unknown> =>
  Effect.gen(function* () {
    const rows = yield* Effect.forEach([...new Set(productIds)], (id) =>
      api.from("products").select().equals([generation, id]),
    );
    const unitsPerPack = new Map<string, number>(
      rows.flat().map((row) => [row.id, row.unitsPerPack]),
    );
    return (productId: string) => unitsPerPack.get(productId) ?? 1;
  });

const invoiceNumberHolder = (
  api: ReplicaQueryBuilder,
  generation: number,
  invoiceNumber: number,
  excludedId: string,
) =>
  api
    .from("invoices")
    .select("byInvoiceNumber")
    .equals([generation, invoiceNumber])
    .pipe(Effect.map((rows) => rows.find((row) => row.id !== excludedId)));

const highestInvoiceNumber = (
  api: ReplicaQueryBuilder,
  generation: number,
  excludedId?: string,
) => {
  const [lower, upper] = generationBounds(generation);
  return api
    .from("invoices")
    .select("byInvoiceNumber")
    .between(lower, upper)
    .reverse()
    .limit(excludedId === undefined ? 1 : 2)
    .pipe(Effect.map((rows) => rows.find((row) => row.id !== excludedId)?.invoiceNumber ?? 0));
};

const categoryNameHolder = (
  api: ReplicaQueryBuilder,
  generation: number,
  name: string,
  excludedId: string,
) =>
  api
    .from("categories")
    .select("byName")
    .equals([generation, name])
    .pipe(Effect.map((rows) => rows.find((row) => row.id !== excludedId)));

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
  resolveCollisions = false,
): Effect.Effect<CommandProjection, unknown> =>
  Effect.gen(function* () {
    const projection = projectCommand(envelope, actor, lookup);
    for (const projected of projection.rows) {
      yield* journalEntry(api, envelope.operationId, projected, generation);
      if (projected.row === null) {
        yield* removeEntityRow(api, generation, projected.entity, projected.entityId);
      } else if (projected.entity === "invoice" && resolveCollisions) {
        const holder = yield* invoiceNumberHolder(
          api,
          generation,
          projected.row.invoiceNumber,
          projected.row.id,
        );
        yield* writeEntityRow(api, generation, projected.entity, {
          ...projected.row,
          invoiceNumber: holder
            ? freeInvoiceNumber(
                projected.row.invoiceNumber,
                yield* highestInvoiceNumber(api, generation, projected.row.id),
              )
            : projected.row.invoiceNumber,
        });
      } else if (projected.entity === "category" && resolveCollisions) {
        const category = projected.row;
        const holder = yield* categoryNameHolder(api, generation, category.name, category.id);
        const name = holder
          ? yield* nextFreeCategoryName(category.name, (candidate) =>
              categoryNameHolder(api, generation, candidate, category.id).pipe(
                Effect.map((other) => other !== undefined),
              ),
            )
          : category.name;
        yield* writeEntityRow(api, generation, projected.entity, { ...category, name });
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
    const collision = yield* invoiceNumberHolder(
      api,
      generation,
      incoming.invoiceNumber,
      incoming.id,
    );
    if (!collision) return undefined;
    const mark = yield* pendingMark(api, "invoice", collision.id);
    if (mark === undefined || mark === operationId) return undefined;
    const highest = yield* highestInvoiceNumber(api, generation);
    yield* api
      .from("invoices")
      .upsert({ ...collision, invoiceNumber: freeInvoiceNumber(incoming.invoiceNumber, highest) });
    return `invoice:${collision.id}`;
  });

export const renameIndexedDbCollidingCategory = (
  api: ReplicaQueryBuilder,
  generation: number,
  incoming: { readonly id: string; readonly name: string },
  operationId: string,
): Effect.Effect<string | undefined, unknown> =>
  Effect.gen(function* () {
    const collision = yield* categoryNameHolder(api, generation, incoming.name, incoming.id);
    if (!collision) return undefined;
    const mark = yield* pendingMark(api, "category", collision.id);
    if (mark === undefined || mark === operationId) return undefined;
    const name = yield* nextFreeCategoryName(collision.name, (candidate) =>
      candidate === incoming.name
        ? Effect.succeed(true)
        : categoryNameHolder(api, generation, candidate, "").pipe(
            Effect.map((other) => other !== undefined),
          ),
    );
    yield* api.from("categories").upsert({ ...collision, name });
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
  entity: SyncEntity,
  entityId: string,
  excludedOperationId: string,
): Effect.Effect<ReadonlyArray<JournalHolder>, unknown> =>
  Effect.gen(function* () {
    const entries = yield* api
      .from("pending_row_journal")
      .select("byEntity")
      .equals([entity, entityId]);
    const holders: Array<JournalHolder> = [];
    for (const entry of entries) {
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
    const journal = yield* api
      .from("pending_row_journal")
      .select("byOperation")
      .equals(operationId);
    const touchedEntities = new Set<SyncEntity>();
    const touchedKeys: Array<string> = [];
    const ordered = Array.sort(
      journal.map((entry) => ({
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
      const others = yield* journalHolders(api, entry.entity, entry.entityId, operationId);
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
    yield* api.from("pending_row_journal").delete("byEntity").equals([entity, entityId]);
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
      const envelope = yield* decodeStoredEnvelope(row);
      const { lookup } = yield* readIndexedDbCommandContext(api, generation, envelope.command, {
        checkRules: false,
        withStock: false,
      });
      yield* writeIndexedDbPendingProjection(api, generation, actor, lookup, envelope, true);
    }
  });
