import {
  INT4_MAX,
  PARTITION_DIGEST_VERSION,
  type SyncEntity,
  type SyncProtocolCode,
} from "@store/contracts";
import { syncEntityRows, type SyncEntityRow } from "@store/contracts/entity-rows";
import { sha256Hex } from "@store/contracts/operation-hash";
import {
  authorityState,
  batches,
  catalogImport,
  categories,
  importParts,
  invoiceItems,
  invoices,
  products,
  purchaseOrderItems,
  purchaseOrders,
  stockMovements,
  suppliers,
} from "@store/db/authority.schema";
import { writeEntityRow, type ReplicaDb } from "@store/sync/authority";
import { asc, eq, ne } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { SqlClient } from "effect/sql/SqlClient";

import { partitionDigest } from "./digest";
import { refuse, type Actor, type AuthorityEngine } from "./engine";
import { byteLengthOf, type CommitFanout } from "./frames";
import type { AuthoritySnapshots } from "./snapshots";

const IMPORT_ID = /^[A-Za-z0-9._-]{1,200}$/u;

const SHA256_HEX = /^[0-9a-f]{64}$/u;

const IMPORT_REFUSAL =
  "This organization already has inventory. A device's data can only be moved into an empty organization.";

const PartEnvelope = Schema.fromJsonString(
  Schema.Struct({
    snapshotId: Schema.String,
    partNumber: Schema.Number,
    rows: Schema.Array(Schema.Json),
  }),
);

const decodePartEnvelope = Schema.decodeUnknownEffect(PartEnvelope);

const decodeFrames = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.Json)));

const decodeFrameHeader = Schema.decodeUnknownOption(
  Schema.Struct({
    entity: Schema.optionalKey(Schema.String),
    entityId: Schema.optionalKey(Schema.String),
  }),
);

const decodeImportResult = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ digest: Schema.String })),
);

const IMPORT_ENTITIES = [
  "category",
  "product",
  "batch",
  "invoice",
  "invoiceItem",
  "supplier",
  "purchaseOrder",
  "purchaseOrderItem",
  "stockMovement",
] as const satisfies ReadonlyArray<SyncEntity>;

type ImportEntity = (typeof IMPORT_ENTITIES)[number];

const isImportEntity = (entity: string | undefined): entity is ImportEntity =>
  IMPORT_ENTITIES.some((known) => known === entity);

const frameSchema = <Row extends Schema.Top>(entity: ImportEntity, row: Row) =>
  Schema.Struct({
    entity: Schema.Literal(entity),
    entityId: Schema.String,
    rowVersion: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    row,
  });

const frameDecoders = {
  category: Schema.decodeUnknownResult(frameSchema("category", syncEntityRows.category.schema)),
  product: Schema.decodeUnknownResult(frameSchema("product", syncEntityRows.product.schema)),
  batch: Schema.decodeUnknownResult(frameSchema("batch", syncEntityRows.batch.schema)),
  invoice: Schema.decodeUnknownResult(frameSchema("invoice", syncEntityRows.invoice.schema)),
  invoiceItem: Schema.decodeUnknownResult(
    frameSchema("invoiceItem", syncEntityRows.invoiceItem.schema),
  ),
  supplier: Schema.decodeUnknownResult(frameSchema("supplier", syncEntityRows.supplier.schema)),
  purchaseOrder: Schema.decodeUnknownResult(
    frameSchema("purchaseOrder", syncEntityRows.purchaseOrder.schema),
  ),
  purchaseOrderItem: Schema.decodeUnknownResult(
    frameSchema("purchaseOrderItem", syncEntityRows.purchaseOrderItem.schema),
  ),
  stockMovement: Schema.decodeUnknownResult(
    frameSchema("stockMovement", syncEntityRows.stockMovement.schema),
  ),
};

type Rows = { readonly [E in ImportEntity]: Array<SyncEntityRow<E>> };

type StagedFrame = {
  readonly entity: string | undefined;
  readonly entityId: string | undefined;
  readonly value: Schema.Json;
};

type ImportProblem = { readonly code: SyncProtocolCode; readonly message: string };

const fitsInt4 = (...values: ReadonlyArray<number | null>) =>
  values.every((value) => value === null || Math.abs(value) <= INT4_MAX);

const duplicateOf = <A>(values: ReadonlyArray<A>): A | undefined => {
  const seen = new Set<A>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
};

const invalidRow = (entity: ImportEntity, entityId: string | undefined, problem: string) =>
  refuse(
    "INVALID_OPERATION",
    `The import holds an invalid ${entity} row: ${entityId ?? "unnamed"} at ${problem}.`,
  );

const decodeEntity = <E extends ImportEntity>(
  entity: E,
  frames: ReadonlyArray<StagedFrame>,
  decode: (
    value: Schema.Json,
  ) => Result.Result<
    { readonly entityId: string; readonly rowVersion: number; readonly row: SyncEntityRow<E> },
    Schema.SchemaError
  >,
) =>
  Effect.gen(function* () {
    const rows: Array<SyncEntityRow<E>> = [];
    for (const frame of frames.filter((candidate) => candidate.entity === entity)) {
      const decoded = decode(frame.value);
      if (Result.isFailure(decoded)) return yield* invalidRow(entity, frame.entityId, "row");
      const { entityId, rowVersion, row } = decoded.success;
      if (row.id !== entityId) return yield* invalidRow(entity, entityId, "entityId");
      const stored = "rowVersion" in row ? row.rowVersion : 1;
      if (stored !== rowVersion) return yield* invalidRow(entity, entityId, "rowVersion");
      rows.push(row);
    }
    return rows;
  });

const decodeRows = Effect.fn("AuthorityImports.decodeRows")(function* (
  frames: ReadonlyArray<StagedFrame>,
) {
  const stranger = frames.find((frame) => !isImportEntity(frame.entity));
  if (stranger !== undefined) {
    return yield* refuse(
      "SCHEMA_VERSION_UNSUPPORTED",
      `This server cannot import ${stranger.entity ?? "unnamed"} rows.`,
    );
  }
  const rows: Rows = {
    category: yield* decodeEntity("category", frames, frameDecoders.category),
    product: yield* decodeEntity("product", frames, frameDecoders.product),
    batch: yield* decodeEntity("batch", frames, frameDecoders.batch),
    invoice: yield* decodeEntity("invoice", frames, frameDecoders.invoice),
    invoiceItem: yield* decodeEntity("invoiceItem", frames, frameDecoders.invoiceItem),
    supplier: yield* decodeEntity("supplier", frames, frameDecoders.supplier),
    purchaseOrder: yield* decodeEntity("purchaseOrder", frames, frameDecoders.purchaseOrder),
    purchaseOrderItem: yield* decodeEntity(
      "purchaseOrderItem",
      frames,
      frameDecoders.purchaseOrderItem,
    ),
    stockMovement: yield* decodeEntity("stockMovement", frames, frameDecoders.stockMovement),
  };
  for (const item of rows.purchaseOrderItem) {
    const unitsMatch =
      item.quantityType === "unit"
        ? item.baseUnitQuantity === item.quantity
        : item.baseUnitQuantity % item.quantity === 0;
    if (!unitsMatch) {
      return yield* invalidRow("purchaseOrderItem", item.id, "row.baseUnitQuantity");
    }
  }
  for (const movement of rows.stockMovement) {
    const delivery =
      movement.purchaseOrderId === null ||
      (movement.type === "stock_in" &&
        movement.invoiceId === null &&
        movement.packDelta >= 0 &&
        movement.unitDelta >= 0 &&
        movement.packDelta + movement.unitDelta !== 0);
    if (!delivery) return yield* invalidRow("stockMovement", movement.id, "row.purchaseOrderId");
  }
  const inRange =
    rows.product.every((row) =>
      fitsInt4(row.unitsPerPack, row.purchasePrice, row.retailPrice, row.unitPrice),
    ) &&
    rows.batch.every((row) => fitsInt4(row.packQuantity, row.unitQuantity)) &&
    rows.invoice.every((row) => fitsInt4(row.invoiceNumber, row.total)) &&
    rows.invoiceItem.every((row) => fitsInt4(row.quantity, row.baseUnitQuantity, row.salePrice)) &&
    rows.purchaseOrder.every((row) => fitsInt4(row.orderNumber, row.total)) &&
    rows.purchaseOrderItem.every((row) =>
      fitsInt4(row.quantity, row.baseUnitQuantity, row.packCost, row.receivedBaseUnits),
    ) &&
    rows.stockMovement.every((row) => fitsInt4(row.packDelta, row.unitDelta));
  if (!inRange) return yield* refuse("INVALID_OPERATION", "A value in the import is out of range.");
  return rows;
});

const catalogProblem = (rows: Rows): ImportProblem | undefined => {
  for (const entity of IMPORT_ENTITIES) {
    if (duplicateOf(rows[entity].map((row) => row.id)) !== undefined) {
      return { code: "ENTITY_CONFLICT", message: "The import holds the same record twice." };
    }
  }
  if (duplicateOf(rows.category.map((row) => row.name)) !== undefined) {
    return {
      code: "ENTITY_CONFLICT",
      message: "The import holds two categories with the same name.",
    };
  }
  const categoryIds = new Set<string>(rows.category.map((row) => row.id));
  const orphanCategory = rows.product.find((row) => !categoryIds.has(row.categoryId));
  if (orphanCategory !== undefined) {
    return {
      code: "ENTITY_RELATION_INVALID",
      message: `Category ${orphanCategory.categoryId} is not in the import.`,
    };
  }
  const productIds = new Set<string>(rows.product.map((row) => row.id));
  const stranded = rows.batch.find(
    (row) => !productIds.has(row.productId) && (row.packQuantity > 0 || row.unitQuantity > 0),
  );
  if (stranded !== undefined) {
    return {
      code: "ENTITY_RELATION_INVALID",
      message: `Batch ${stranded.id} holds stock for a product that is not in the import.`,
    };
  }
  if (duplicateOf(rows.invoice.map((row) => row.invoiceNumber)) !== undefined) {
    return { code: "ENTITY_CONFLICT", message: "The import holds two sales with the same number." };
  }
  const invoiceIds = new Set<string>(rows.invoice.map((row) => row.id));
  if (
    rows.invoiceItem.some((row) => !invoiceIds.has(row.invoiceId)) ||
    rows.stockMovement.some((row) => row.invoiceId !== null && !invoiceIds.has(row.invoiceId))
  ) {
    return {
      code: "ENTITY_RELATION_INVALID",
      message: "The import holds a row that refers to a record it does not contain.",
    };
  }
  return undefined;
};

const purchasingProblem = (rows: Rows): ImportProblem | undefined => {
  if (duplicateOf(rows.supplier.map((row) => row.name)) !== undefined) {
    return {
      code: "ENTITY_CONFLICT",
      message: "The import holds two suppliers with the same name.",
    };
  }
  if (duplicateOf(rows.purchaseOrder.map((row) => row.orderNumber)) !== undefined) {
    return {
      code: "ENTITY_CONFLICT",
      message: "The import holds two purchase orders with the same number.",
    };
  }
  const supplierIds = new Set<string>(rows.supplier.map((row) => row.id));
  const orphanSupplier = rows.purchaseOrder.find((row) => !supplierIds.has(row.supplierId));
  if (orphanSupplier !== undefined) {
    return {
      code: "ENTITY_RELATION_INVALID",
      message: `Supplier ${orphanSupplier.supplierId} is not in the import.`,
    };
  }
  const orderIds = new Set<string>(rows.purchaseOrder.map((row) => row.id));
  const orphanLine = rows.purchaseOrderItem.find((row) => !orderIds.has(row.purchaseOrderId));
  const orphanDelivery = rows.stockMovement.find(
    (row) => row.purchaseOrderId !== null && !orderIds.has(row.purchaseOrderId),
  );
  const orphanOrder = orphanLine?.purchaseOrderId ?? orphanDelivery?.purchaseOrderId;
  if (orphanOrder !== undefined && orphanOrder !== null) {
    return {
      code: "ENTITY_RELATION_INVALID",
      message: `Purchase order ${orphanOrder} is not in the import.`,
    };
  }
  const keyOf = (order: string, product: string) => `${order}\u0000${product}`;
  const delivered = new Map<string, { readonly order: string; readonly units: number }>();
  for (const row of rows.stockMovement) {
    if (row.purchaseOrderId === null) continue;
    const key = keyOf(row.purchaseOrderId, row.productId);
    delivered.set(key, {
      order: row.purchaseOrderId,
      units: (delivered.get(key)?.units ?? 0) + row.packDelta + row.unitDelta,
    });
  }
  const received = new Map<string, { readonly order: string; readonly units: number }>();
  for (const row of rows.purchaseOrderItem) {
    const key = keyOf(row.purchaseOrderId, row.productId);
    received.set(key, {
      order: row.purchaseOrderId,
      units: (received.get(key)?.units ?? 0) + row.receivedBaseUnits,
    });
  }
  for (const key of new Set([...delivered.keys(), ...received.keys()])) {
    const delivery = delivered.get(key);
    const receipt = received.get(key);
    const units = receipt?.units ?? 0;
    if (units < (delivery?.units ?? 0) || (units > 0 && delivery === undefined)) {
      return {
        code: "ENTITY_RELATION_INVALID",
        message: `Purchase order ${delivery?.order ?? receipt?.order ?? ""} holds received stock that does not match its deliveries.`,
      };
    }
  }
  return undefined;
};

const touchesPurchasing = (rows: Rows) =>
  rows.supplier.length > 0 ||
  rows.purchaseOrder.length > 0 ||
  rows.purchaseOrderItem.length > 0 ||
  rows.stockMovement.some((row) => row.purchaseOrderId !== null);

export type ImportLimits = {
  readonly maxBytes: number;
  readonly maxRows: number;
  readonly maxParts: number;
};

export type ImportCommitRequest = {
  readonly organizationId: string;
  readonly partCount: number;
  readonly digest: string;
  readonly digestVersion: number;
};

export const makeAuthorityImports = (
  sql: SqlClient,
  engine: AuthorityEngine,
  db: ReplicaDb,
  snapshotsOf: AuthoritySnapshots,
) => {
  const refusal = Effect.fn("AuthorityImports.refusal")(function* () {
    const committed = yield* db.select({ id: catalogImport.id }).from(catalogImport).get();
    if (committed !== undefined) return IMPORT_REFUSAL;
    const state = yield* engine.loadState;
    if (state !== undefined && state.commitSequence > 0) return IMPORT_REFUSAL;
    for (const table of [
      categories,
      products,
      batches,
      invoices,
      invoiceItems,
      stockMovements,
      suppliers,
      purchaseOrders,
      purchaseOrderItems,
    ]) {
      const held = yield* db.select({ id: table.id }).from(table).limit(1).get();
      if (held !== undefined) return IMPORT_REFUSAL;
    }
    return undefined;
  });

  const staged = Effect.fn("AuthorityImports.staged")(function* (importId: string) {
    const parts = yield* db
      .select({ framesJson: importParts.framesJson })
      .from(importParts)
      .where(eq(importParts.importId, importId))
      .orderBy(asc(importParts.partNumber))
      .all();
    const frames: Array<StagedFrame> = [];
    for (const part of parts) {
      for (const value of yield* decodeFrames(part.framesJson).pipe(Effect.orDie)) {
        const header = decodeFrameHeader(value);
        frames.push({
          entity: header._tag === "Some" ? header.value.entity : undefined,
          entityId: header._tag === "Some" ? header.value.entityId : undefined,
          value,
        });
      }
    }
    return frames;
  });

  const purchasingGate = Effect.fn("AuthorityImports.purchasingGate")(function* (now: number) {
    const stale = (yield* engine.activeReplicas(now))
      .filter((replica) => replica.schemaVersion < 2)
      .sort(
        (left, right) =>
          right.lastSeenAt - left.lastSeenAt || (left.replicaId < right.replicaId ? -1 : 1),
      )[0];
    if (stale !== undefined) {
      return yield* refuse(
        "REPLICA_SCHEMA_OUTDATED",
        `Update Tabaaq on ${stale.deviceLabel || "another device"} before moving suppliers and purchase orders into this organization.`,
      );
    }
  });

  const importRows = Effect.fn("AuthorityImports.importRows")(function* (
    actor: Actor,
    frames: ReadonlyArray<StagedFrame>,
    now: number,
  ) {
    const rows = yield* decodeRows(frames);
    const catalog = catalogProblem(rows);
    if (catalog !== undefined) return yield* refuse(catalog.code, catalog.message);
    if (touchesPurchasing(rows)) yield* purchasingGate(now);
    const purchasing = purchasingProblem(rows);
    if (purchasing !== undefined) return yield* refuse(purchasing.code, purchasing.message);
    const owner = {
      organizationId: actor.organizationId,
      createdByUserId: actor.userId,
      updatedByUserId: actor.userId,
    };
    for (const row of rows.category) yield* writeEntityRow(db, "category", { ...row, ...owner });
    for (const row of rows.product) yield* writeEntityRow(db, "product", { ...row, ...owner });
    for (const row of rows.batch) yield* writeEntityRow(db, "batch", { ...row, ...owner });
    for (const row of rows.invoice) yield* writeEntityRow(db, "invoice", { ...row, ...owner });
    for (const row of rows.invoiceItem) {
      yield* writeEntityRow(db, "invoiceItem", { ...row, ...owner });
    }
    for (const row of rows.supplier) yield* writeEntityRow(db, "supplier", { ...row, ...owner });
    for (const row of rows.purchaseOrder) {
      yield* writeEntityRow(db, "purchaseOrder", { ...row, ...owner });
    }
    for (const row of rows.purchaseOrderItem) {
      yield* writeEntityRow(db, "purchaseOrderItem", { ...row, ...owner });
    }
    for (const row of rows.stockMovement) {
      yield* writeEntityRow(db, "stockMovement", {
        ...row,
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
      });
    }
    return IMPORT_ENTITIES.map((entity) => ({ entity, rowCount: rows[entity].length }));
  });

  const verified = (digestVersion: number) =>
    digestVersion === PARTITION_DIGEST_VERSION ? partitionDigest(db) : Effect.undefined;

  return {
    stagePart: Effect.fn("AuthorityImports.stagePart")(function* (
      importId: string,
      partNumber: number,
      payload: string,
      now: number,
      limits: ImportLimits,
    ) {
      if (!IMPORT_ID.test(importId)) {
        return yield* refuse("INVALID_OPERATION", "The import id is malformed.");
      }
      if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > limits.maxParts) {
        return yield* refuse(
          "INVALID_OPERATION",
          `An import holds between 1 and ${limits.maxParts} parts.`,
        );
      }
      const byteLength = byteLengthOf(payload);
      if (byteLength > limits.maxBytes) {
        return yield* refuse(
          "INVALID_OPERATION",
          `An import part holds at most ${limits.maxBytes} bytes.`,
        );
      }
      const part = yield* decodePartEnvelope(payload).pipe(
        Effect.catchTag("SchemaError", () =>
          refuse("INVALID_OPERATION", "The import part is not valid JSON."),
        ),
      );
      if (
        part.snapshotId !== importId ||
        part.partNumber !== partNumber ||
        part.rows.length < 1 ||
        part.rows.length > limits.maxRows
      ) {
        return yield* refuse(
          "INVALID_OPERATION",
          `The import part does not name this import and part, or holds no rows or more than ${limits.maxRows}.`,
        );
      }
      const sha256 = yield* sha256Hex(payload);
      const body = JSON.stringify({ partNumber, byteLength, sha256 });
      return yield* engine.transact(
        Effect.gen(function* () {
          const committed = yield* db
            .select({ importId: catalogImport.importId })
            .from(catalogImport)
            .get();
          if (committed?.importId === importId) return body;
          const refused = yield* refusal();
          if (refused !== undefined) return yield* refuse("ENTITY_CONFLICT", refused);
          yield* db.delete(importParts).where(ne(importParts.importId, importId));
          const stored = {
            byteLength,
            sha256,
            framesJson: JSON.stringify(part.rows),
            receivedAt: now,
          };
          yield* db
            .insert(importParts)
            .values({ importId, partNumber, ...stored })
            .onConflictDoUpdate({
              target: [importParts.importId, importParts.partNumber],
              set: stored,
            });
          return body;
        }),
      );
    }),

    commit: Effect.fn("AuthorityImports.commit")(function* (
      actor: Actor,
      importId: string,
      request: ImportCommitRequest,
      now: number,
      incarnation: string,
    ) {
      if (
        !IMPORT_ID.test(importId) ||
        !Number.isSafeInteger(request.partCount) ||
        request.partCount < 1 ||
        !Number.isSafeInteger(request.digestVersion) ||
        request.digestVersion < 1 ||
        !SHA256_HEX.test(request.digest)
      ) {
        return yield* refuse("INVALID_OPERATION", "The import request is malformed.");
      }
      if (request.organizationId !== actor.organizationId) {
        return yield* refuse(
          "ORGANIZATION_MISMATCH",
          "The import does not belong to the active organization.",
        );
      }
      return yield* engine.transact(
        Effect.gen(function* () {
          const state = yield* engine.ensureState(actor, now, incarnation);
          const committedFanout = (horizon: string): CommitFanout => ({
            epoch: state.epoch,
            horizon,
            group: "",
            byteLength: 0,
            originReplicaId: "",
          });
          const done = yield* db.select().from(catalogImport).get();
          if (done !== undefined && done.importId === importId) {
            const result = yield* decodeImportResult(done.resultJson).pipe(Effect.orDie);
            if (result.digest === request.digest) {
              yield* db.delete(importParts);
              return {
                json: done.resultJson,
                fanout: committedFanout(String(state.commitSequence)),
              };
            }
          }
          const refused = yield* refusal();
          if (refused !== undefined) return yield* refuse("ENTITY_CONFLICT", refused);
          const arrived = (yield* db
            .select({ partNumber: importParts.partNumber })
            .from(importParts)
            .where(eq(importParts.importId, importId))
            .all()).map((part) => part.partNumber);
          if (
            arrived.length !== request.partCount ||
            Math.min(...arrived) !== 1 ||
            Math.max(...arrived) !== request.partCount
          ) {
            return yield* refuse(
              "INVALID_OPERATION",
              `The import is incomplete: ${arrived.length} of ${request.partCount} parts arrived.`,
            );
          }
          const frames = yield* staged(importId);
          const imported = yield* sql.withTransaction(
            Effect.gen(function* () {
              const counts = yield* importRows(actor, frames, now);
              const digest = yield* verified(request.digestVersion);
              if (digest === undefined) {
                return yield* refuse(
                  "SCHEMA_VERSION_UNSUPPORTED",
                  `This server cannot verify digest version ${request.digestVersion}.`,
                );
              }
              if (digest.digest !== request.digest) {
                return yield* refuse(
                  "INVALID_PAYLOAD_HASH",
                  "The rows that arrived do not match this device's data. Nothing was moved.",
                );
              }
              return { counts, digest };
            }),
          );
          yield* snapshotsOf.clearForImport();
          yield* db
            .update(authorityState)
            .set({ commitSequence: 1, retentionFloor: 1 })
            .where(eq(authorityState.id, state.id));
          const resultJson = JSON.stringify({
            importId,
            horizon: "1",
            entityCounts: imported.counts,
            digest: imported.digest.digest,
            digestVersion: imported.digest.version,
          });
          yield* db.insert(catalogImport).values({
            id: 1,
            importId,
            committedByUserId: actor.userId,
            committedAt: now,
            resultJson,
          });
          yield* db.delete(importParts);
          return { json: resultJson, fanout: committedFanout("1") };
        }),
      );
    }),

    status: Effect.fn("AuthorityImports.status")(function* (importId: string) {
      return yield* engine.transact(
        Effect.gen(function* () {
          const done = yield* db.select().from(catalogImport).get();
          if (done !== undefined && done.importId === importId) {
            return { _tag: "committed" as const, json: done.resultJson };
          }
          const refused = yield* refusal();
          return refused === undefined
            ? { _tag: "none" as const }
            : { _tag: "other" as const, message: refused };
        }),
      );
    }),
  };
};
