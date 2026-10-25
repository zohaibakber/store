import {
  allocationsCoverInput,
  checkCanChangeUnitsPerPack,
  checkCanDeleteBatch,
  checkCanDeleteCategory,
  checkCanDeleteProduct,
  openPackMovementId,
  purchasingRejection,
  takeFromStock,
  type CatalogRowWrite,
  type SyncCommandEnvelope,
  type SyncLogChange,
} from "@store/contracts";
import { type SyncEntityRow } from "@store/contracts/entity-rows";
import { ReplicaBatchRow } from "@store/contracts/sync/replica-model";
import * as Array from "effect/Array";
import * as Order from "effect/Order";
import * as Result from "effect/Result";

import {
  decideCatalogRow,
  projectCommand,
  type CatalogEntity,
  type ProjectedUpsert,
  type ProjectionActor,
  type ReplicaCatalogLookup,
} from "../replica/projection";
import {
  ALREADY_EXISTS,
  NO_CATALOG,
  changeOf,
  hasStock,
  rejected,
  stampOf,
  type Accepted,
  type CatalogPayload,
  type Decision,
  type InvoicePayload,
  type InvoiceTake,
  type LocalCatalogFacts,
  type LocalInvoiceFacts,
  type PurchasingEntity,
  type Rejection,
  type StagedCatalogRows,
  upsertOf,
} from "./decision";

const byHighestOrderNumber: Order.Order<{ readonly orderNumber: number }> = Order.flip(
  Order.mapInput(Order.Number, (order) => order.orderNumber),
);

export const decideCatalogWrite = (
  payload: CatalogPayload,
  actor: ProjectionActor,
  facts: LocalCatalogFacts,
): Decision => {
  const staged: StagedCatalogRows = {
    category: new Map(),
    product: new Map(),
    batch: new Map(),
    supplier: new Map(),
    purchaseOrder: new Map(),
    purchaseOrderItem: new Map(),
  };
  const stagedMovements = new Set<string>();

  const current = <Entity extends CatalogEntity>(
    entity: Entity,
    id: string,
  ): SyncEntityRow<Entity> | undefined => {
    const overlay = staged[entity];
    return overlay.has(id) ? overlay.get(id) : facts.rows[entity].get(id);
  };

  const live = <Entity extends CatalogEntity>(
    entity: Entity,
  ): ReadonlyArray<SyncEntityRow<Entity>> =>
    [...new Set([...facts.rows[entity].keys(), ...staged[entity].keys()])].flatMap((id) => {
      const row = current(entity, id);
      return row === undefined ? [] : [row];
    });

  const lookup: ReplicaCatalogLookup = {
    ...NO_CATALOG,
    category: (id) => current("category", id),
    product: (id) => current("product", id),
    batch: (id) => current("batch", id),
    supplier: (id) => current("supplier", id),
    purchaseOrder: (id) => current("purchaseOrder", id),
    purchaseOrderItem: (id) => current("purchaseOrderItem", id),
    supplierNamed: (name) => live("supplier").find((supplier) => supplier.name === name),
    purchaseOrdersOfSupplier: (supplierId) =>
      live("purchaseOrder").filter((order) => order.supplierId === supplierId),
    itemsOfPurchaseOrder: (purchaseOrderId) =>
      live("purchaseOrderItem").filter((item) => item.purchaseOrderId === purchaseOrderId),
    purchaseOrderNumbered: (orderNumber) =>
      live("purchaseOrder").find((order) => order.orderNumber === orderNumber),
    get highestPurchaseOrders() {
      return Array.sort(live("purchaseOrder"), byHighestOrderNumber);
    },
  };

  const categoryProducts = (categoryId: string) => {
    const loaded = live("product").filter((product) => product.categoryId === categoryId);
    return facts.categoriesHoldingOtherProducts.has(categoryId)
      ? [{ categoryId }, ...loaded]
      : loaded;
  };

  const stockedBatches = (productId: string) => {
    const loaded = live("batch").filter(
      (batch) => batch.productId === productId && hasStock(batch),
    );
    if (loaded.length > 0 || !facts.productsHoldingOtherStock.has(productId)) return loaded;
    return [{ productId, packQuantity: 1, unitQuantity: 0 }];
  };

  const conflictIfRefused = <A>(decision: Result.Result<A, { readonly message: string }>) =>
    Result.isFailure(decision) ? rejected("ENTITY_CONFLICT", decision.failure.message) : undefined;

  const record = (projected: ProjectedUpsert): Result.Result<SyncLogChange, Rejection> => {
    switch (projected.entity) {
      case "category":
        staged.category.set(projected.entityId, projected.row);
        return upsertOf(projected);
      case "product":
        staged.product.set(projected.entityId, projected.row);
        return upsertOf(projected);
      case "batch":
        staged.batch.set(projected.entityId, projected.row);
        return upsertOf(projected);
      case "supplier":
        staged.supplier.set(projected.entityId, projected.row);
        return upsertOf(projected);
      case "purchaseOrder":
        staged.purchaseOrder.set(projected.entityId, projected.row);
        return upsertOf(projected);
      case "purchaseOrderItem":
        staged.purchaseOrderItem.set(projected.entityId, projected.row);
        return upsertOf(projected);
      case "stockMovement": {
        if (
          facts.recordedMovementIds.has(projected.entityId) ||
          stagedMovements.has(projected.entityId)
        ) {
          return rejected("ENTITY_CONFLICT", `Movement ${projected.entityId} is already recorded.`);
        }
        stagedMovements.add(projected.entityId);
        return upsertOf(projected);
      }
      case "invoice":
      case "invoiceItem":
        return upsertOf(projected);
    }
  };

  const upsert = (
    write: Extract<CatalogRowWrite, { readonly action: "upsert" }>,
  ): Result.Result<ReadonlyArray<SyncLogChange>, Rejection> =>
    Result.gen(function* () {
      const rows = yield* decideCatalogRow(payload, actor, lookup, write);
      const upserts = rows.flatMap((projected) => (projected.row === null ? [] : [projected]));
      const receivedLine =
        write.entity === "batch"
          ? upserts.find((projected) => projected.entity === "purchaseOrderItem")
          : undefined;
      if (receivedLine !== undefined) yield* upsertOf(receivedLine);
      const changes: Array<SyncLogChange> = [];
      for (const projected of upserts) changes.push(yield* record(projected));
      return changes;
    });

  const remove = (
    write: Extract<
      CatalogRowWrite,
      { readonly entity: PurchasingEntity; readonly action: "delete" }
    >,
  ): Result.Result<ReadonlyArray<SyncLogChange>, Rejection> =>
    Result.map(decideCatalogRow(payload, actor, lookup, write), () => {
      const existing = current(write.entity, write.id);
      if (existing === undefined) return [];
      staged[write.entity].set(write.id, undefined);
      return [changeOf(write.entity, "delete", write.id, existing.rowVersion + 1, existing)];
    });

  const decideWrite = (
    write: CatalogRowWrite,
  ): Result.Result<ReadonlyArray<SyncLogChange>, Rejection> => {
    switch (write.entity) {
      case "category": {
        const existing = lookup.category(write.id);
        switch (write.action) {
          case "delete": {
            if (existing === undefined) {
              return rejected("ENTITY_CONFLICT", `Category ${write.id} is no longer available.`);
            }
            if (write.expectedRowVersion !== existing.rowVersion) {
              return rejected("ENTITY_CONFLICT", `Category ${write.id} changed since it was read.`);
            }
            const categoryBlocked = conflictIfRefused(
              checkCanDeleteCategory(categoryProducts(write.id), write.id),
            );
            if (categoryBlocked) return categoryBlocked;
            staged.category.set(write.id, undefined);
            return Result.succeed([
              changeOf("category", "delete", write.id, existing.rowVersion + 1, existing),
            ]);
          }
          case "upsert": {
            if (write.expectedRowVersion === null && existing !== undefined) {
              return rejected("ENTITY_CONFLICT", `Category ${write.id} already exists.`);
            }
            if (write.expectedRowVersion !== null && existing === undefined) {
              return rejected("ENTITY_CONFLICT", `Category ${write.id} is no longer available.`);
            }
            if (
              live("category").some(
                (category) => category.name === write.row.name && category.id !== write.id,
              )
            ) {
              return rejected(
                "ENTITY_CONFLICT",
                `Category name ${write.row.name} is already in use.`,
              );
            }
            return upsert(write);
          }
        }
      }
      case "product": {
        const existing = lookup.product(write.id);
        switch (write.action) {
          case "delete": {
            if (existing === undefined) {
              return rejected("ENTITY_CONFLICT", `Product ${write.id} is no longer available.`);
            }
            if (write.expectedRowVersion !== existing.rowVersion) {
              return rejected("ENTITY_CONFLICT", `Product ${write.id} changed since it was read.`);
            }
            const productBlocked = conflictIfRefused(
              checkCanDeleteProduct(stockedBatches(write.id), write.id),
            );
            if (productBlocked) return productBlocked;
            const image = {
              ...existing,
              ...stampOf(payload, actor, existing),
            };
            staged.product.set(write.id, undefined);
            return Result.succeed([
              changeOf("product", "delete", write.id, image.rowVersion, image),
            ]);
          }
          case "upsert": {
            const categoryMissing = lookup.category(write.row.categoryId) === undefined;
            const relationInvalid = rejected(
              "ENTITY_RELATION_INVALID",
              `Category ${write.row.categoryId} is not available in this organization.`,
            );
            if (write.expectedRowVersion === null) {
              if (existing !== undefined) {
                return rejected("ENTITY_CONFLICT", `Product ${write.id} already exists.`);
              }
              return categoryMissing ? relationInvalid : upsert(write);
            }
            if (existing === undefined) {
              return rejected("ENTITY_CONFLICT", `Product ${write.id} is no longer available.`);
            }
            if (write.row.unitsPerPack !== existing.unitsPerPack) {
              if (write.expectedRowVersion !== existing.rowVersion) {
                return rejected(
                  "ENTITY_CONFLICT",
                  `Product ${write.id} changed since units per pack was read.`,
                );
              }
              const unitsBlocked = conflictIfRefused(
                checkCanChangeUnitsPerPack(stockedBatches(write.id), write.id),
              );
              if (unitsBlocked) return unitsBlocked;
            }
            return write.row.categoryId !== existing.categoryId && categoryMissing
              ? relationInvalid
              : upsert(write);
          }
        }
      }
      case "batch": {
        const existing = lookup.batch(write.id);
        switch (write.action) {
          case "delete": {
            if (existing === undefined) {
              return rejected("ENTITY_CONFLICT", `Batch ${write.id} is no longer available.`);
            }
            if (write.expectedRowVersion !== existing.rowVersion) {
              return rejected("ENTITY_CONFLICT", `Batch ${write.id} changed since it was read.`);
            }
            const batchBlocked = conflictIfRefused(checkCanDeleteBatch(existing));
            if (batchBlocked) return batchBlocked;
            const image = {
              ...existing,
              ...stampOf(payload, actor, existing),
            };
            staged.batch.set(write.id, undefined);
            return Result.succeed([changeOf("batch", "delete", write.id, image.rowVersion, image)]);
          }
          case "upsert": {
            if (lookup.product(write.row.productId) === undefined) {
              return rejected(
                "ENTITY_RELATION_INVALID",
                `Product ${write.row.productId} is not available in this organization.`,
              );
            }
            if (write.receipt !== undefined && write.expectedRowVersion !== null) {
              return Result.fail(purchasingRejection.receiptOnExistingBatch);
            }
            if (write.expectedRowVersion === null) {
              return existing === undefined
                ? upsert(write)
                : rejected("ENTITY_CONFLICT", `Batch ${write.id} already exists.`);
            }
            if (existing === undefined) {
              return rejected("ENTITY_CONFLICT", `Batch ${write.id} is no longer available.`);
            }
            if (write.expectedRowVersion !== existing.rowVersion) {
              return rejected("ENTITY_CONFLICT", `Batch ${write.id} changed since it was read.`);
            }
            return upsert(write);
          }
        }
      }
      case "supplier":
      case "purchaseOrder":
      case "purchaseOrderItem":
        switch (write.action) {
          case "delete":
            return remove(write);
          case "upsert":
            return upsert(write);
        }
    }
  };

  return Result.gen(function* () {
    const changes: Array<SyncLogChange> = [];
    for (const write of payload.writes) {
      changes.push(...(yield* decideWrite(write)));
    }
    return {
      result: { _tag: "catalogWrite", rowsWritten: payload.writes.length },
      changes,
    } satisfies Accepted;
  });
};

type InvoicePlan = {
  readonly take: InvoiceTake;
  readonly opened: number;
  readonly batch: ReplicaBatchRow;
};

export const decideIssueInvoice = (
  envelope: SyncCommandEnvelope,
  payload: InvoicePayload,
  actor: ProjectionActor,
  facts: LocalInvoiceFacts,
): Decision =>
  Result.gen(function* () {
    if (payload.input.items.length === 0) {
      return yield* rejected("INVALID_OPERATION", "Add at least one item to the sale.");
    }
    if (!allocationsCoverInput(payload.input, payload.allocations)) {
      return yield* rejected("INVALID_OPERATION", "The sale allocations do not match the items.");
    }
    if (facts.invoice !== undefined && facts.invoice.operationId !== payload.commandId) {
      return yield* rejected("INVOICE_IDENTITY_CONFLICT", "This invoice id is already in use.");
    }

    const working = new Map<string, ReplicaBatchRow>();
    const plans: Array<InvoicePlan> = [];
    for (const take of payload.allocations) {
      const product = facts.products.get(take.productId);
      if (product === undefined) {
        return yield* rejected("INSUFFICIENT_STOCK", "One of the products no longer exists.");
      }
      const owned = facts.batches.get(take.batchId);
      const held =
        working.get(take.batchId) ?? (owned?.productId === product.id ? owned : undefined);
      if (held === undefined) {
        return yield* rejected(
          "INSUFFICIENT_STOCK",
          `The selected batch for ${product.name} is gone.`,
        );
      }
      const taken = yield* Result.mapError(
        takeFromStock(held, product, take),
        (refusal): Rejection => ({ code: "INSUFFICIENT_STOCK", message: refusal.message }),
      );
      const remaining = {
        ...held,
        packQuantity: taken.nextPackQuantity,
        unitQuantity: taken.nextUnitQuantity,
      };
      working.set(take.batchId, remaining);
      plans.push({
        take,
        opened: taken.packsOpened,
        batch: { ...remaining, ...stampOf(payload, actor, held) },
      });
    }

    const invoiceNumber = facts.invoiceNumberTaken
      ? facts.highestInvoiceNumber + 1
      : payload.invoiceNumber;
    const projection = yield* projectCommand(
      {
        ...envelope,
        command: {
          _tag: "issueInvoice",
          payload: {
            ...payload,
            invoiceNumber,
            allocations: plans.map((plan) => ({ ...plan.take, packsOpened: plan.opened })),
          },
        },
      },
      actor,
      {
        ...NO_CATALOG,
        product: (id) => facts.products.get(id),
        batch: (id) => facts.batches.get(id),
      },
    );
    const images = new Map<string, ProjectedUpsert>();
    for (const projected of projection.rows) {
      if (projected.row !== null)
        images.set(`${projected.entity}:${projected.entityId}`, projected);
    }
    const created = new Set<string>();
    const create = (
      entity: "invoice" | "invoiceItem" | "stockMovement",
      id: string,
      recorded: boolean,
    ): Result.Result<SyncLogChange, Rejection> =>
      Result.gen(function* () {
        const key = `${entity}:${id}`;
        const projected = images.get(key);
        if (projected === undefined) {
          return yield* rejected("ENTITY_WRITE_FAILED", "The invoice could not be created.");
        }
        const change = yield* upsertOf(projected);
        if (recorded || created.has(key)) return yield* ALREADY_EXISTS;
        created.add(key);
        return change;
      });

    const changes: Array<SyncLogChange> = [
      yield* create("invoice", payload.invoiceId, facts.invoice !== undefined),
    ];
    for (const { take, opened, batch } of plans) {
      const item = yield* create(
        "invoiceItem",
        take.invoiceItemId,
        facts.recordedItemIds.has(take.invoiceItemId),
      );
      changes.push(changeOf("batch", "upsert", batch.id, batch.rowVersion, batch), item);
      if (opened > 0) {
        const openPackId = openPackMovementId(take);
        changes.push(
          yield* create("stockMovement", openPackId, facts.recordedMovementIds.has(openPackId)),
        );
      }
      changes.push(
        yield* create(
          "stockMovement",
          take.saleMovementId,
          facts.recordedMovementIds.has(take.saleMovementId),
        ),
      );
    }
    return {
      result: { _tag: "issueInvoice", invoiceId: payload.invoiceId, invoiceNumber },
      changes,
    } satisfies Accepted;
  });
