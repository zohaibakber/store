import {
  assertCanChangeUnitsPerPack,
  assertCanDeleteBatch,
  assertCanDeleteCategory,
  assertCanDeleteProduct,
  catalogWriteError,
  syncProtocolError,
  type SyncCommandEnvelope,
  type SyncEntity,
} from "@store/contracts";
import type {
  ReplicaBatchRow,
  ReplicaCategoryRow,
  ReplicaInvoiceItemRow,
  ReplicaInvoiceRow,
  ReplicaProductRow,
  ReplicaStockMovementRow,
} from "@store/contracts/sync/replica-model";
import * as Effect from "effect/Effect";

import type { VisibleStock } from "./decisions";
import { mapReplicaStoreFailure, type ReplicaStoreError } from "./errors";

export type ProjectionActor = {
  readonly organizationId: string;
  readonly userId: string;
};

export type ReplicaCatalogLookup = {
  readonly category: (categoryId: string) => ReplicaCategoryRow | undefined;
  readonly product: (productId: string) => ReplicaProductRow | undefined;
  readonly batch: (batchId: string) => ReplicaBatchRow | undefined;
  readonly productsByCategory: (categoryId: string) => ReadonlyArray<ReplicaProductRow>;
  readonly batchesByProduct: (productId: string) => ReadonlyArray<ReplicaBatchRow>;
};

export type ProjectedRemoval = {
  readonly entity: SyncEntity;
  readonly entityId: string;
  readonly row: null;
};

export type ProjectedUpsert =
  | { readonly entity: "category"; readonly entityId: string; readonly row: ReplicaCategoryRow }
  | { readonly entity: "product"; readonly entityId: string; readonly row: ReplicaProductRow }
  | { readonly entity: "batch"; readonly entityId: string; readonly row: ReplicaBatchRow }
  | { readonly entity: "invoice"; readonly entityId: string; readonly row: ReplicaInvoiceRow }
  | {
      readonly entity: "invoiceItem";
      readonly entityId: string;
      readonly row: ReplicaInvoiceItemRow;
    }
  | {
      readonly entity: "stockMovement";
      readonly entityId: string;
      readonly row: ReplicaStockMovementRow;
    };

export type ProjectedRow = ProjectedUpsert | ProjectedRemoval;

export type ReplicaEntityRowImage =
  | ReplicaCategoryRow
  | ReplicaProductRow
  | ReplicaBatchRow
  | ReplicaInvoiceRow
  | ReplicaInvoiceItemRow
  | ReplicaStockMovementRow;

export type PendingRestoreResult = {
  readonly touchedEntities: ReadonlyArray<SyncEntity>;
  readonly touchedKeys: ReadonlyArray<string>;
};

export type CommandProjection = {
  readonly rows: ReadonlyArray<ProjectedRow>;
  readonly touchedEntities: ReadonlyArray<SyncEntity>;
  readonly touchedKeys: ReadonlyArray<string>;
};

const emptyProjection: CommandProjection = { rows: [], touchedEntities: [], touchedKeys: [] };

const summarize = (rows: ReadonlyArray<ProjectedRow>): CommandProjection => {
  const entities = new Set<SyncEntity>();
  const keys: Array<string> = [];
  for (const row of rows) {
    entities.add(row.entity);
    keys.push(`${row.entity}:${row.entityId}`);
  }
  return { rows, touchedEntities: [...entities], touchedKeys: keys };
};

const trimmedName = (value: string | null): string | null => {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const projectIssueInvoice = (
  envelope: Extract<SyncCommandEnvelope["command"], { readonly _tag: "issueInvoice" }>,
  actor: ProjectionActor,
  lookup: ReplicaCatalogLookup,
): CommandProjection => {
  const command = envelope.payload;
  const total = command.input.items.reduce((sum, line) => sum + line.quantity * line.salePrice, 0);
  const rows: Array<ProjectedRow> = [
    {
      entity: "invoice",
      entityId: command.invoiceId,
      row: {
        id: command.invoiceId,
        invoiceNumber: command.invoiceNumber,
        customerName: trimmedName(command.input.customerName),
        total,
        createdAt: command.occurredAt,
        updatedAt: command.occurredAt,
        organizationId: actor.organizationId,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
        deviceId: command.deviceId,
        operationId: command.commandId,
        rowVersion: 1,
      },
    },
  ];

  for (const take of command.allocations) {
    const product = lookup.product(take.productId);
    const batch = lookup.batch(take.batchId);
    const unitsPerPack = product?.unitsPerPack ?? 1;
    rows.push({
      entity: "invoiceItem",
      entityId: take.invoiceItemId,
      row: {
        id: take.invoiceItemId,
        invoiceId: command.invoiceId,
        productId: take.productId,
        batchId: take.batchId,
        productName: product?.name ?? take.productId,
        batchNumber: batch?.batchNumber ?? null,
        quantity: take.quantity,
        quantityType: take.quantityType,
        baseUnitQuantity: take.quantity * (take.quantityType === "pack" ? unitsPerPack : 1),
        salePrice: take.salePrice,
        createdAt: command.occurredAt,
        updatedAt: command.occurredAt,
        organizationId: actor.organizationId,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
        deviceId: command.deviceId,
        operationId: command.commandId,
        rowVersion: 1,
      },
    });
    if (take.packsOpened > 0) {
      const openPackId = take.openPackMovementId ?? `${take.saleMovementId}:open-pack`;
      rows.push({
        entity: "stockMovement",
        entityId: openPackId,
        row: {
          id: openPackId,
          productId: take.productId,
          batchId: take.batchId,
          invoiceId: command.invoiceId,
          type: "open_pack",
          packDelta: -take.packsOpened,
          unitDelta: take.packsOpened * unitsPerPack,
          note: `Opened for invoice #${command.invoiceNumber}`,
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          deviceId: command.deviceId,
          operationId: command.commandId,
          createdAt: command.occurredAt,
        },
      });
    }
    rows.push({
      entity: "stockMovement",
      entityId: take.saleMovementId,
      row: {
        id: take.saleMovementId,
        productId: take.productId,
        batchId: take.batchId,
        invoiceId: command.invoiceId,
        type: "sale",
        packDelta: take.quantityType === "pack" ? -take.quantity : 0,
        unitDelta: take.quantityType === "unit" ? -take.quantity : 0,
        note: `Invoice #${command.invoiceNumber}`,
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        deviceId: command.deviceId,
        operationId: command.commandId,
        createdAt: command.occurredAt,
      },
    });
  }

  return summarize(rows);
};

type CatalogWorking = {
  readonly categories: Map<string, ReplicaCategoryRow | null>;
  readonly products: Map<string, ReplicaProductRow | null>;
  readonly batches: Map<string, ReplicaBatchRow | null>;
};

const workingCategory = (
  working: CatalogWorking,
  lookup: ReplicaCatalogLookup,
  categoryId: string,
): ReplicaCategoryRow | undefined => {
  const staged = working.categories.get(categoryId);
  if (staged !== undefined) return staged ?? undefined;
  return lookup.category(categoryId);
};

const workingProduct = (
  working: CatalogWorking,
  lookup: ReplicaCatalogLookup,
  productId: string,
): ReplicaProductRow | undefined => {
  const staged = working.products.get(productId);
  if (staged !== undefined) return staged ?? undefined;
  return lookup.product(productId);
};

const workingBatch = (
  working: CatalogWorking,
  lookup: ReplicaCatalogLookup,
  batchId: string,
): ReplicaBatchRow | undefined => {
  const staged = working.batches.get(batchId);
  if (staged !== undefined) return staged ?? undefined;
  return lookup.batch(batchId);
};

const insertedMetadata = (
  actor: ProjectionActor,
  deviceId: string,
  operationId: string,
  occurredAt: number,
) => ({
  createdAt: occurredAt,
  updatedAt: occurredAt,
  organizationId: actor.organizationId,
  createdByUserId: actor.userId,
  updatedByUserId: actor.userId,
  deviceId,
  operationId,
  rowVersion: 1,
});

const updatedMetadata = (
  existing: {
    readonly createdAt: number;
    readonly createdByUserId: string;
    readonly rowVersion: number;
  },
  actor: ProjectionActor,
  deviceId: string,
  operationId: string,
  occurredAt: number,
) => ({
  createdAt: existing.createdAt,
  updatedAt: occurredAt,
  organizationId: actor.organizationId,
  createdByUserId: existing.createdByUserId,
  updatedByUserId: actor.userId,
  deviceId,
  operationId,
  rowVersion: existing.rowVersion + 1,
});

const movementType = (packDelta: number, unitDelta: number): "stock_in" | "adjustment" =>
  packDelta >= 0 && unitDelta >= 0 ? "stock_in" : "adjustment";

const projectCatalogWrite = (
  envelope: Extract<SyncCommandEnvelope["command"], { readonly _tag: "catalogWrite" }>,
  actor: ProjectionActor,
  lookup: ReplicaCatalogLookup,
): CommandProjection => {
  const command = envelope.payload;
  const working: CatalogWorking = {
    categories: new Map(),
    products: new Map(),
    batches: new Map(),
  };
  const rows: Array<ProjectedRow> = [];

  for (const write of command.writes) {
    if (write.entity === "category") {
      if (write.action === "delete") {
        const existing = workingCategory(working, lookup, write.id);
        if (!existing) continue;
        working.categories.set(write.id, null);
        rows.push({ entity: "category", entityId: write.id, row: null });
        continue;
      }
      const existing = workingCategory(working, lookup, write.id);
      const row: ReplicaCategoryRow = {
        id: write.id,
        name: write.row.name,
        tracksPacks: write.row.tracksPacks,
        ...(existing
          ? updatedMetadata(
              existing,
              actor,
              command.deviceId,
              command.commandId,
              command.occurredAt,
            )
          : insertedMetadata(actor, command.deviceId, command.commandId, command.occurredAt)),
      };
      working.categories.set(write.id, row);
      rows.push({ entity: "category", entityId: write.id, row });
      continue;
    }

    if (write.entity === "product") {
      if (write.action === "delete") {
        const existing = workingProduct(working, lookup, write.id);
        if (!existing) continue;
        working.products.set(write.id, null);
        rows.push({ entity: "product", entityId: write.id, row: null });
        continue;
      }
      const existing = workingProduct(working, lookup, write.id);
      const row: ReplicaProductRow = {
        id: write.id,
        name: write.row.name,
        categoryId: write.row.categoryId,
        aisle: write.row.aisle,
        composition: write.row.composition,
        strength: write.row.strength,
        unitsPerPack: write.row.unitsPerPack,
        purchasePrice: write.row.purchasePrice,
        retailPrice: write.row.retailPrice,
        unitPrice: write.row.unitPrice,
        visible: write.row.visible,
        ...(existing
          ? updatedMetadata(
              existing,
              actor,
              command.deviceId,
              command.commandId,
              command.occurredAt,
            )
          : insertedMetadata(actor, command.deviceId, command.commandId, command.occurredAt)),
      };
      working.products.set(write.id, row);
      rows.push({ entity: "product", entityId: write.id, row });
      continue;
    }

    if (write.action === "delete") {
      const existing = workingBatch(working, lookup, write.id);
      if (!existing) continue;
      working.batches.set(write.id, null);
      rows.push({ entity: "batch", entityId: write.id, row: null });
      continue;
    }

    const existing = workingBatch(working, lookup, write.id);
    const row: ReplicaBatchRow = {
      id: write.id,
      productId: write.row.productId,
      batchNumber: write.row.batchNumber,
      expiresAt: write.row.expiresAt,
      packQuantity: write.row.packQuantity,
      unitQuantity: write.row.unitQuantity,
      ...(existing
        ? updatedMetadata(existing, actor, command.deviceId, command.commandId, command.occurredAt)
        : insertedMetadata(actor, command.deviceId, command.commandId, command.occurredAt)),
    };
    working.batches.set(write.id, row);
    rows.push({ entity: "batch", entityId: write.id, row });

    const packDelta = row.packQuantity - (existing?.packQuantity ?? 0);
    const unitDelta = row.unitQuantity - (existing?.unitQuantity ?? 0);
    if (packDelta === 0 && unitDelta === 0) continue;
    rows.push({
      entity: "stockMovement",
      entityId: write.movementId,
      row: {
        id: write.movementId,
        productId: row.productId,
        batchId: row.id,
        invoiceId: null,
        type: movementType(packDelta, unitDelta),
        packDelta,
        unitDelta,
        note: write.note,
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        deviceId: command.deviceId,
        operationId: command.commandId,
        createdAt: command.occurredAt,
      },
    });
  }

  return summarize(rows);
};

export const projectCommand = (
  envelope: SyncCommandEnvelope,
  actor: ProjectionActor,
  lookup: ReplicaCatalogLookup,
): CommandProjection => {
  if (envelope.command._tag === "issueInvoice") {
    return projectIssueInvoice(envelope.command, actor, lookup);
  }
  if (envelope.command._tag === "catalogWrite") {
    return projectCatalogWrite(envelope.command, actor, lookup);
  }
  return emptyProjection;
};

const assertInvoiceStock = (
  envelope: Extract<SyncCommandEnvelope["command"], { readonly _tag: "issueInvoice" }>,
  unitsPerPackFor: (productId: string) => number,
  stockFor: (batchId: string) => VisibleStock,
): void => {
  const working = new Map<string, VisibleStock>();
  for (const take of envelope.payload.allocations) {
    const unitsPerPack = unitsPerPackFor(take.productId);
    const current = working.get(take.batchId) ?? stockFor(take.batchId);
    const available =
      take.quantityType === "pack"
        ? current.packQuantity
        : current.packQuantity * unitsPerPack + current.unitQuantity;
    if (available < take.quantity) {
      throw syncProtocolError(
        "INSUFFICIENT_STOCK",
        `Not enough stock for ${take.productId}: ${available} available, ${take.quantity} requested.`,
      );
    }
    const packDelta = take.quantityType === "pack" ? -take.quantity : -take.packsOpened;
    const unitDelta =
      take.quantityType === "pack" ? 0 : take.packsOpened * unitsPerPack - take.quantity;
    const nextPackQuantity = current.packQuantity + packDelta;
    const nextUnitQuantity = current.unitQuantity + unitDelta;
    if (nextPackQuantity < 0 || nextUnitQuantity < 0) {
      throw syncProtocolError("INSUFFICIENT_STOCK", `Not enough stock for ${take.productId}.`);
    }
    working.set(take.batchId, {
      packQuantity: nextPackQuantity,
      unitQuantity: nextUnitQuantity,
    });
  }
};

const catalogRuleError = (cause: unknown): never => {
  const message = cause instanceof Error ? cause.message : "The catalog write is not allowed.";
  if (
    message === catalogWriteError.categoryHasProducts ||
    message === catalogWriteError.productHasStock
  ) {
    throw syncProtocolError("ENTITY_RELATION_INVALID", message);
  }
  throw syncProtocolError("ENTITY_CONFLICT", message);
};

const guardCatalogRule = (run: () => void): void => {
  try {
    run();
  } catch (cause) {
    catalogRuleError(cause);
  }
};

const assertCatalogWriteAllowed = (
  envelope: Extract<SyncCommandEnvelope["command"], { readonly _tag: "catalogWrite" }>,
  lookup: ReplicaCatalogLookup,
): void => {
  for (const write of envelope.payload.writes) {
    if (write.entity === "category" && write.action === "delete") {
      guardCatalogRule(() =>
        assertCanDeleteCategory(lookup.productsByCategory(write.id), write.id),
      );
      continue;
    }
    if (write.entity === "product") {
      if (write.action === "delete") {
        guardCatalogRule(() => assertCanDeleteProduct(lookup.batchesByProduct(write.id), write.id));
        continue;
      }
      const existing = lookup.product(write.id);
      if (existing && existing.unitsPerPack !== write.row.unitsPerPack) {
        guardCatalogRule(() =>
          assertCanChangeUnitsPerPack(lookup.batchesByProduct(write.id), write.id),
        );
      }
      continue;
    }
    if (write.entity === "batch" && write.action === "delete") {
      const existing = lookup.batch(write.id);
      if (!existing) continue;
      guardCatalogRule(() => assertCanDeleteBatch(existing));
    }
  }
};

const assertEnqueueAllowed = (
  envelope: SyncCommandEnvelope,
  lookup: ReplicaCatalogLookup,
  unitsPerPackFor: (productId: string) => number,
  stockFor: (batchId: string) => VisibleStock,
): void => {
  if (envelope.command._tag === "issueInvoice") {
    assertInvoiceStock(envelope.command, unitsPerPackFor, stockFor);
    return;
  }
  if (envelope.command._tag === "catalogWrite") {
    assertCatalogWriteAllowed(envelope.command, lookup);
  }
};

export const checkEnqueueAllowed = (
  envelope: SyncCommandEnvelope,
  lookup: ReplicaCatalogLookup,
  unitsPerPackFor: (productId: string) => number,
  stockFor: (batchId: string) => VisibleStock,
): Effect.Effect<void, ReplicaStoreError> =>
  Effect.try({
    try: () => assertEnqueueAllowed(envelope, lookup, unitsPerPackFor, stockFor),
    catch: mapReplicaStoreFailure,
  });
