import {
  checkCanChangeUnitsPerPack,
  checkCanDeleteBatch,
  checkCanDeleteCategory,
  checkCanDeleteProduct,
  canCreatePurchaseOrderAs,
  canMovePurchaseOrder,
  isPurchaseOrderOpen,
  purchaseOrderLineBaseUnits,
  purchasingRejection,
  receivedBaseUnitsOf,
  SyncProtocolError,
  syncProtocolError,
  type CatalogRowWrite,
  type SyncCommandEnvelope,
  type SyncEntity,
  type SyncProtocolCode,
} from "@store/contracts";
import type { CatalogRefusal } from "@store/contracts/catalog-refusal";
import type { SyncEntityRow } from "@store/contracts/entity-rows";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { freeDocumentNumber, type VisibleStock } from "./decisions";
import { mapReplicaStoreFailure, type ReplicaStoreError } from "./errors";

export type ProjectionActor = {
  readonly organizationId: string;
  readonly userId: string;
};

export type CatalogEntity = CatalogRowWrite["entity"];

type EntityReference = { readonly id: string };

type NumberedOrderReference = EntityReference & { readonly orderNumber: number };

type CatalogRowLookup = {
  readonly [Entity in CatalogEntity]: (id: string) => SyncEntityRow<Entity> | undefined;
};

type CatalogRuleLookup = {
  readonly productInCategory: (categoryId: string) => { readonly categoryId: string } | undefined;
  readonly stockedBatchOfProduct: (productId: string) => SyncEntityRow<"batch"> | undefined;
  readonly supplierNamed: (name: string) => EntityReference | undefined;
  readonly purchaseOrdersOfSupplier: (supplierId: string) => ReadonlyArray<EntityReference>;
  readonly itemsOfPurchaseOrder: (purchaseOrderId: string) => ReadonlyArray<EntityReference>;
  readonly purchaseOrderNumbered: (orderNumber: number) => EntityReference | undefined;
  readonly highestPurchaseOrders: ReadonlyArray<NumberedOrderReference>;
};

export type ReplicaCatalogLookup = CatalogRowLookup & CatalogRuleLookup;

type ProjectedRemoval = {
  readonly entity: SyncEntity;
  readonly entityId: string;
  readonly row: null;
};

export type ProjectedUpsert = {
  readonly [Entity in SyncEntity]: {
    readonly entity: Entity;
    readonly entityId: string;
    readonly row: SyncEntityRow<Entity>;
  };
}[SyncEntity];

export type ProjectedRow = ProjectedUpsert | ProjectedRemoval;

export type ReplicaEntityRowImage = SyncEntityRow<SyncEntity>;

export type PendingRestoreResult = {
  readonly touchedEntities: ReadonlyArray<SyncEntity>;
  readonly touchedKeys: ReadonlyArray<string>;
};

export type CommandProjection = {
  readonly rows: ReadonlyArray<ProjectedRow>;
  readonly touchedEntities: ReadonlyArray<SyncEntity>;
  readonly touchedKeys: ReadonlyArray<string>;
};

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
          purchaseOrderId: null,
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
        purchaseOrderId: null,
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

type CatalogWrite = Extract<
  SyncCommandEnvelope["command"],
  { readonly _tag: "catalogWrite" }
>["payload"];

type WriteOf<Entity extends CatalogEntity> = Extract<CatalogRowWrite, { readonly entity: Entity }>;

type CatalogWorking = {
  readonly [Entity in CatalogEntity]: Map<string, SyncEntityRow<Entity> | null>;
};

type CatalogPass = {
  readonly command: CatalogWrite;
  readonly actor: ProjectionActor;
  readonly lookup: ReplicaCatalogLookup;
  readonly enforce: boolean;
  readonly working: CatalogWorking;
  readonly rows: Array<ProjectedRow>;
};

export type CommandRejection = { readonly code: SyncProtocolCode; readonly message: string };

type Rejection = CommandRejection;

type PurchasingEntity = "supplier" | "purchaseOrder" | "purchaseOrderItem";

const purchasingLabel = {
  supplier: "Supplier",
  purchaseOrder: "Purchase order",
  purchaseOrderItem: "Order line",
} as const satisfies Record<PurchasingEntity, string>;

const conflict = (message: string): Rejection => ({ code: "ENTITY_CONFLICT", message });

const alreadyExists = (entity: PurchasingEntity, id: string): Rejection =>
  conflict(`${purchasingLabel[entity]} ${id} already exists.`);

const noLongerAvailable = (entity: PurchasingEntity, id: string): Rejection =>
  conflict(`${purchasingLabel[entity]} ${id} is no longer available.`);

const changedSinceRead = (entity: PurchasingEntity, id: string): Rejection =>
  conflict(`${purchasingLabel[entity]} ${id} changed since it was read.`);

const notInOrganization = (label: string, id: string): Rejection => ({
  code: "ENTITY_RELATION_INVALID",
  message: `${label} ${id} is not available in this organization.`,
});

const refuse = (pass: CatalogPass, rejection: Rejection): void => {
  if (pass.enforce) throw syncProtocolError(rejection.code, rejection.message);
};

const guard = (pass: CatalogPass, run: () => Result.Result<void, CatalogRefusal>): void => {
  if (!pass.enforce) return;
  const result = run();
  if (Result.isFailure(result)) {
    throw syncProtocolError("ENTITY_CONFLICT", result.failure.message);
  }
};

const current = <Entity extends CatalogEntity>(
  pass: CatalogPass,
  entity: Entity,
  id: string,
): SyncEntityRow<Entity> | undefined => {
  const staged = pass.working[entity].get(id);
  if (staged !== undefined) return staged ?? undefined;
  const rows: CatalogRowLookup = pass.lookup;
  return rows[entity](id);
};

const stagedRows = <Entity extends CatalogEntity>(
  pass: CatalogPass,
  entity: Entity,
): ReadonlyArray<SyncEntityRow<Entity>> =>
  [...pass.working[entity].values()].flatMap((row) => (row === null ? [] : [row]));

const remove = (pass: CatalogPass, entity: CatalogEntity, id: string): void => {
  pass.working[entity].set(id, null);
  pass.rows.push({ entity, entityId: id, row: null });
};

const insertedMetadata = (pass: CatalogPass) => ({
  createdAt: pass.command.occurredAt,
  updatedAt: pass.command.occurredAt,
  organizationId: pass.actor.organizationId,
  createdByUserId: pass.actor.userId,
  updatedByUserId: pass.actor.userId,
  deviceId: pass.command.deviceId,
  operationId: pass.command.commandId,
  rowVersion: 1,
});

type MutableRowMetadata = {
  readonly createdAt: number;
  readonly createdByUserId: string;
  readonly rowVersion: number;
};

const updatedMetadata = (pass: CatalogPass, existing: MutableRowMetadata) => ({
  createdAt: existing.createdAt,
  updatedAt: pass.command.occurredAt,
  organizationId: pass.actor.organizationId,
  createdByUserId: existing.createdByUserId,
  updatedByUserId: pass.actor.userId,
  deviceId: pass.command.deviceId,
  operationId: pass.command.commandId,
  rowVersion: existing.rowVersion + 1,
});

const writtenMetadata = (pass: CatalogPass, existing: MutableRowMetadata | undefined) =>
  existing ? updatedMetadata(pass, existing) : insertedMetadata(pass);

type VersionedTarget = {
  readonly id: string;
  readonly expectedRowVersion: number | null;
};

const movementType = (write: VersionedTarget): "stock_in" | "adjustment" =>
  write.expectedRowVersion === null ? "stock_in" : "adjustment";

const checkUpsertTarget = (
  pass: CatalogPass,
  entity: PurchasingEntity,
  write: VersionedTarget,
  existing: MutableRowMetadata | undefined,
): void => {
  if (write.expectedRowVersion === null && existing) {
    refuse(pass, alreadyExists(entity, write.id));
  }
  if (write.expectedRowVersion !== null && !existing) {
    refuse(pass, noLongerAvailable(entity, write.id));
  }
};

const checkDeleteTarget = (
  pass: CatalogPass,
  entity: PurchasingEntity,
  write: VersionedTarget,
  existing: MutableRowMetadata | undefined,
): void => {
  if (!existing) {
    refuse(pass, noLongerAvailable(entity, write.id));
    return;
  }
  if (existing.rowVersion !== write.expectedRowVersion) {
    refuse(pass, changedSinceRead(entity, write.id));
  }
};

const untouched = (pass: CatalogPass, entity: CatalogEntity, reference: EntityReference) =>
  !pass.working[entity].has(reference.id);

const supplierNameTaken = (pass: CatalogPass, supplierId: string, name: string): boolean => {
  if (stagedRows(pass, "supplier").some((row) => row.id !== supplierId && row.name === name)) {
    return true;
  }
  const holder = pass.lookup.supplierNamed(name);
  return holder !== undefined && holder.id !== supplierId && untouched(pass, "supplier", holder);
};

const supplierHasOrders = (pass: CatalogPass, supplierId: string): boolean =>
  stagedRows(pass, "purchaseOrder").some((row) => row.supplierId === supplierId) ||
  pass.lookup
    .purchaseOrdersOfSupplier(supplierId)
    .some((order) => untouched(pass, "purchaseOrder", order));

const purchaseOrderHasItems = (pass: CatalogPass, purchaseOrderId: string): boolean =>
  stagedRows(pass, "purchaseOrderItem").some((row) => row.purchaseOrderId === purchaseOrderId) ||
  pass.lookup
    .itemsOfPurchaseOrder(purchaseOrderId)
    .some((item) => untouched(pass, "purchaseOrderItem", item));

const purchaseOrderIsClosed = (pass: CatalogPass, purchaseOrderId: string): boolean => {
  const order = current(pass, "purchaseOrder", purchaseOrderId);
  return order !== undefined && !isPurchaseOrderOpen(order.status);
};

const freeOrderNumber = (pass: CatalogPass, purchaseOrderId: string, proposed: number): number => {
  const staged = stagedRows(pass, "purchaseOrder").filter((row) => row.id !== purchaseOrderId);
  const holder = pass.lookup.purchaseOrderNumbered(proposed);
  const taken =
    staged.some((row) => row.orderNumber === proposed) ||
    (holder !== undefined &&
      holder.id !== purchaseOrderId &&
      untouched(pass, "purchaseOrder", holder));
  if (!taken) return proposed;
  const highestStored = pass.lookup.highestPurchaseOrders.find(
    (order) => pass.working.purchaseOrder.get(order.id) !== null,
  );
  return freeDocumentNumber(
    proposed,
    staged.reduce(
      (highest, row) => Math.max(highest, row.orderNumber),
      highestStored?.orderNumber ?? 0,
    ),
  );
};

const writeCategory = (pass: CatalogPass, write: WriteOf<"category">): void => {
  const existing = current(pass, "category", write.id);
  switch (write.action) {
    case "delete": {
      const blocking = pass.lookup.productInCategory(write.id);
      guard(pass, () => checkCanDeleteCategory(blocking ? [blocking] : [], write.id));
      if (existing) remove(pass, "category", write.id);
      return;
    }
    case "upsert": {
      const row: SyncEntityRow<"category"> = {
        id: write.id,
        name: write.row.name,
        tracksPacks: write.row.tracksPacks,
        ...writtenMetadata(pass, existing),
      };
      pass.working.category.set(write.id, row);
      pass.rows.push({ entity: "category", entityId: write.id, row });
      return;
    }
    default:
      return write satisfies never;
  }
};

const writeProduct = (pass: CatalogPass, write: WriteOf<"product">): void => {
  const existing = current(pass, "product", write.id);
  switch (write.action) {
    case "delete": {
      const stocked = pass.lookup.stockedBatchOfProduct(write.id);
      guard(pass, () => checkCanDeleteProduct(stocked ? [stocked] : [], write.id));
      if (existing) remove(pass, "product", write.id);
      return;
    }
    case "upsert": {
      const stored = pass.lookup.product(write.id);
      if (stored && stored.unitsPerPack !== write.row.unitsPerPack) {
        const stocked = pass.lookup.stockedBatchOfProduct(write.id);
        guard(pass, () => checkCanChangeUnitsPerPack(stocked ? [stocked] : [], write.id));
      }
      const row: SyncEntityRow<"product"> = {
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
        ...writtenMetadata(pass, existing),
      };
      pass.working.product.set(write.id, row);
      pass.rows.push({ entity: "product", entityId: write.id, row });
      return;
    }
    default:
      return write satisfies never;
  }
};

const receiptLine = (
  pass: CatalogPass,
  write: Extract<WriteOf<"batch">, { readonly action: "upsert" }>,
): SyncEntityRow<"purchaseOrderItem"> | undefined => {
  if (write.receipt === undefined) return undefined;
  if (write.expectedRowVersion !== null) {
    refuse(pass, purchasingRejection.receiptOnExistingBatch);
    return undefined;
  }
  const line = current(pass, "purchaseOrderItem", write.receipt.purchaseOrderItemId);
  if (!line) {
    refuse(
      pass,
      notInOrganization(purchasingLabel.purchaseOrderItem, write.receipt.purchaseOrderItemId),
    );
    return undefined;
  }
  if (line.productId !== write.row.productId) {
    refuse(pass, purchasingRejection.receiptProductMismatch);
  }
  if (purchaseOrderIsClosed(pass, line.purchaseOrderId)) {
    refuse(pass, purchasingRejection.orderNotOpen);
  }
  return line;
};

const writeBatch = (pass: CatalogPass, write: WriteOf<"batch">): void => {
  const existing = current(pass, "batch", write.id);
  switch (write.action) {
    case "delete": {
      const stored = pass.lookup.batch(write.id);
      if (stored) guard(pass, () => checkCanDeleteBatch(stored));
      if (existing) remove(pass, "batch", write.id);
      return;
    }
    case "upsert": {
      const line = receiptLine(pass, write);
      const row: SyncEntityRow<"batch"> = {
        id: write.id,
        productId: write.row.productId,
        batchNumber: write.row.batchNumber,
        expiresAt: write.row.expiresAt,
        packQuantity: write.row.packQuantity,
        unitQuantity: write.row.unitQuantity,
        ...writtenMetadata(pass, existing),
      };
      pass.working.batch.set(write.id, row);
      pass.rows.push({ entity: "batch", entityId: write.id, row });

      const packDelta = row.packQuantity - (existing?.packQuantity ?? 0);
      const unitDelta = row.unitQuantity - (existing?.unitQuantity ?? 0);
      if (packDelta !== 0 || unitDelta !== 0) {
        pass.rows.push({
          entity: "stockMovement",
          entityId: write.movementId,
          row: {
            id: write.movementId,
            productId: row.productId,
            batchId: row.id,
            invoiceId: null,
            purchaseOrderId: line?.purchaseOrderId ?? null,
            type: movementType(write),
            packDelta,
            unitDelta,
            note: write.note,
            organizationId: pass.actor.organizationId,
            actorUserId: pass.actor.userId,
            deviceId: pass.command.deviceId,
            operationId: pass.command.commandId,
            createdAt: pass.command.occurredAt,
          },
        });
      }
      if (!line) return;
      const unitsPerPack = current(pass, "product", row.productId)?.unitsPerPack ?? 1;
      const received: SyncEntityRow<"purchaseOrderItem"> = {
        ...line,
        receivedBaseUnits: line.receivedBaseUnits + receivedBaseUnitsOf(row, unitsPerPack),
        ...updatedMetadata(pass, line),
      };
      pass.working.purchaseOrderItem.set(received.id, received);
      pass.rows.push({ entity: "purchaseOrderItem", entityId: received.id, row: received });
      return;
    }
    default:
      return write satisfies never;
  }
};

const writeSupplier = (pass: CatalogPass, write: WriteOf<"supplier">): void => {
  const existing = current(pass, "supplier", write.id);
  switch (write.action) {
    case "delete": {
      checkDeleteTarget(pass, "supplier", write, existing);
      if (supplierHasOrders(pass, write.id)) refuse(pass, purchasingRejection.supplierHasOrders);
      if (existing) remove(pass, "supplier", write.id);
      return;
    }
    case "upsert": {
      checkUpsertTarget(pass, "supplier", write, existing);
      if (supplierNameTaken(pass, write.id, write.row.name)) {
        refuse(pass, conflict(`Supplier name ${write.row.name} is already in use.`));
      }
      const row: SyncEntityRow<"supplier"> = {
        id: write.id,
        name: write.row.name,
        phone: write.row.phone,
        note: write.row.note,
        ...writtenMetadata(pass, existing),
      };
      pass.working.supplier.set(write.id, row);
      pass.rows.push({ entity: "supplier", entityId: write.id, row });
      return;
    }
    default:
      return write satisfies never;
  }
};

const writePurchaseOrder = (pass: CatalogPass, write: WriteOf<"purchaseOrder">): void => {
  const existing = current(pass, "purchaseOrder", write.id);
  switch (write.action) {
    case "delete": {
      checkDeleteTarget(pass, "purchaseOrder", write, existing);
      if (existing && existing.status !== "draft") {
        refuse(pass, purchasingRejection.orderNotDraft);
      }
      if (purchaseOrderHasItems(pass, write.id)) refuse(pass, purchasingRejection.orderHasItems);
      if (existing) remove(pass, "purchaseOrder", write.id);
      return;
    }
    case "upsert": {
      checkUpsertTarget(pass, "purchaseOrder", write, existing);
      if (existing && !isPurchaseOrderOpen(existing.status)) {
        refuse(pass, purchasingRejection.orderNotOpen);
      }
      const allowed = existing
        ? canMovePurchaseOrder(existing.status, write.row.status)
        : canCreatePurchaseOrderAs(write.row.status);
      if (!allowed) refuse(pass, purchasingRejection.orderTransitionInvalid);
      if (
        existing?.supplierId !== write.row.supplierId &&
        current(pass, "supplier", write.row.supplierId) === undefined
      ) {
        refuse(pass, notInOrganization(purchasingLabel.supplier, write.row.supplierId));
      }
      const row: SyncEntityRow<"purchaseOrder"> = {
        id: write.id,
        orderNumber: existing
          ? existing.orderNumber
          : freeOrderNumber(pass, write.id, write.row.orderNumber),
        supplierId: write.row.supplierId,
        status: write.row.status,
        note: write.row.note,
        sentAt: write.row.sentAt,
        expectedAt: write.row.expectedAt,
        total: write.row.total,
        ...writtenMetadata(pass, existing),
      };
      pass.working.purchaseOrder.set(write.id, row);
      pass.rows.push({ entity: "purchaseOrder", entityId: write.id, row });
      return;
    }
    default:
      return write satisfies never;
  }
};

const writePurchaseOrderItem = (pass: CatalogPass, write: WriteOf<"purchaseOrderItem">): void => {
  const existing = current(pass, "purchaseOrderItem", write.id);
  switch (write.action) {
    case "delete": {
      checkDeleteTarget(pass, "purchaseOrderItem", write, existing);
      if (!existing) return;
      if (purchaseOrderIsClosed(pass, existing.purchaseOrderId)) {
        refuse(pass, purchasingRejection.orderNotOpen);
      }
      if (existing.receivedBaseUnits > 0) refuse(pass, purchasingRejection.itemReceived);
      remove(pass, "purchaseOrderItem", write.id);
      return;
    }
    case "upsert": {
      checkUpsertTarget(pass, "purchaseOrderItem", write, existing);
      const order = current(pass, "purchaseOrder", write.row.purchaseOrderId);
      if (!order) {
        refuse(pass, notInOrganization(purchasingLabel.purchaseOrder, write.row.purchaseOrderId));
      }
      if (
        (order !== undefined && !isPurchaseOrderOpen(order.status)) ||
        (existing !== undefined && purchaseOrderIsClosed(pass, existing.purchaseOrderId))
      ) {
        refuse(pass, purchasingRejection.orderNotOpen);
      }
      if (
        existing !== undefined &&
        existing.receivedBaseUnits > 0 &&
        (existing.productId !== write.row.productId ||
          existing.purchaseOrderId !== write.row.purchaseOrderId)
      ) {
        refuse(pass, purchasingRejection.itemReceived);
      }
      const product = current(pass, "product", write.row.productId);
      if (!product) refuse(pass, notInOrganization("Product", write.row.productId));
      if (
        product !== undefined &&
        write.row.baseUnitQuantity !== purchaseOrderLineBaseUnits(write.row, product.unitsPerPack)
      ) {
        refuse(pass, purchasingRejection.itemQuantityInvalid);
      }
      const row: SyncEntityRow<"purchaseOrderItem"> = {
        id: write.id,
        purchaseOrderId: write.row.purchaseOrderId,
        productId: write.row.productId,
        productName: write.row.productName,
        quantity: write.row.quantity,
        quantityType: write.row.quantityType,
        baseUnitQuantity: write.row.baseUnitQuantity,
        packCost: write.row.packCost,
        receivedBaseUnits: existing?.receivedBaseUnits ?? 0,
        ...writtenMetadata(pass, existing),
      };
      pass.working.purchaseOrderItem.set(write.id, row);
      pass.rows.push({ entity: "purchaseOrderItem", entityId: write.id, row });
      return;
    }
    default:
      return write satisfies never;
  }
};

const applyCatalogWrite = (pass: CatalogPass, write: CatalogRowWrite): void => {
  switch (write.entity) {
    case "category":
      return writeCategory(pass, write);
    case "product":
      return writeProduct(pass, write);
    case "batch":
      return writeBatch(pass, write);
    case "supplier":
      return writeSupplier(pass, write);
    case "purchaseOrder":
      return writePurchaseOrder(pass, write);
    case "purchaseOrderItem":
      return writePurchaseOrderItem(pass, write);
    default:
      return write satisfies never;
  }
};

const runCatalogWrite = (
  command: CatalogWrite,
  actor: ProjectionActor,
  lookup: ReplicaCatalogLookup,
  enforce: boolean,
): ReadonlyArray<ProjectedRow> => {
  const pass: CatalogPass = {
    command,
    actor,
    lookup,
    enforce,
    working: {
      category: new Map(),
      product: new Map(),
      batch: new Map(),
      supplier: new Map(),
      purchaseOrder: new Map(),
      purchaseOrderItem: new Map(),
    },
    rows: [],
  };
  for (const write of command.writes) applyCatalogWrite(pass, write);
  return pass.rows;
};

export const decideCatalogRow = (
  command: CatalogWrite,
  actor: ProjectionActor,
  lookup: ReplicaCatalogLookup,
  write: CatalogRowWrite,
): Result.Result<ReadonlyArray<ProjectedRow>, CommandRejection> =>
  Result.try({
    try: () => runCatalogWrite({ ...command, writes: [write] }, actor, lookup, true),
    catch: (cause) => {
      if (cause instanceof SyncProtocolError) return { code: cause.code, message: cause.message };
      throw cause;
    },
  });

export const projectCommand = (
  envelope: SyncCommandEnvelope,
  actor: ProjectionActor,
  lookup: ReplicaCatalogLookup,
): CommandProjection => {
  switch (envelope.command._tag) {
    case "issueInvoice":
      return projectIssueInvoice(envelope.command, actor, lookup);
    case "catalogWrite":
      return summarize(runCatalogWrite(envelope.command.payload, actor, lookup, false));
  }
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

const RULE_CHECK_USER_ID = "rule-check";

const assertEnqueueAllowed = (
  envelope: SyncCommandEnvelope,
  lookup: ReplicaCatalogLookup,
  unitsPerPackFor: (productId: string) => number,
  stockFor: (batchId: string) => VisibleStock,
): void => {
  switch (envelope.command._tag) {
    case "issueInvoice":
      return assertInvoiceStock(envelope.command, unitsPerPackFor, stockFor);
    case "catalogWrite": {
      runCatalogWrite(
        envelope.command.payload,
        { organizationId: envelope.organizationId, userId: RULE_CHECK_USER_ID },
        lookup,
        true,
      );
      return;
    }
    default:
      return envelope.command satisfies never;
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
