import {
  canMovePurchaseOrder,
  formatInvoiceNumber,
  isPurchaseOrderOpen,
  purchaseOrderLineBaseUnits,
  purchaseOrderLineTotal,
  purchaseOrderTotal,
  purchasingRejection,
} from "@store/contracts";
import { CatalogRefusal } from "@store/contracts/catalog-refusal";
import { createdMutationMetadata, updatedMutationMetadata } from "@store/contracts/catalog-rules";
import {
  MAX_CATALOG_WRITE_ROWS,
  SupplierPhone,
  type CatalogRowWrite,
  type PurchaseOrderQuantityType,
  type PurchaseOrderStatus,
} from "@store/contracts/catalog-write";
import {
  decodeBatchId,
  decodePurchaseOrderId,
  decodePurchaseOrderItemId,
  decodeSupplierId,
} from "@store/contracts/ids";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { productFieldsOf } from "./catalog-projection";
import {
  commandIds,
  requiredRow,
  type CatalogReadableCollection,
  type ProjectionContext,
} from "./projection-context";
import type {
  BatchRow,
  ProductRow,
  PurchaseOrderItemRow,
  PurchaseOrderRow,
  SupplierRow,
} from "./rows";

const MAX_NAME_LENGTH = 200;

const MAX_NOTE_LENGTH = 500;

export type PurchasingProjectionTables = {
  readonly suppliers: CatalogReadableCollection<SupplierRow>;
  readonly purchaseOrders: CatalogReadableCollection<PurchaseOrderRow>;
  readonly purchaseOrderItems: CatalogReadableCollection<PurchaseOrderItemRow>;
  readonly products: CatalogReadableCollection<ProductRow>;
};

export type PurchasingProjectionContext = ProjectionContext<PurchasingProjectionTables>;

export type SaveSupplierInput = {
  readonly id?: string;
  readonly name: string;
  readonly phone?: string | null;
  readonly note?: string | null;
};

export type PurchaseOrderLineInput = {
  readonly id?: string;
  readonly productId: string;
  readonly quantity: number;
  readonly quantityType: PurchaseOrderQuantityType;
  readonly packCost?: number | null;
};

export type SaveOrderDraftInput = {
  readonly id?: string;
  readonly supplierId: string;
  readonly note?: string | null;
  readonly expectedAt?: number | null;
  readonly lines: ReadonlyArray<PurchaseOrderLineInput>;
  readonly send?: boolean;
};

export type SavedPurchaseOrder = {
  readonly order: PurchaseOrderRow;
  readonly lines: ReadonlyArray<PurchaseOrderItemRow>;
};

export type ReceiveDeliveryLineInput = {
  readonly purchaseOrderItemId: string;
  readonly batchNumber?: string | null;
  readonly expiresAt?: number | null;
  readonly packQuantity?: number;
  readonly unitQuantity?: number;
  readonly purchasePrice?: number | null;
  readonly retailPrice?: number | null;
  readonly unitPrice?: number | null;
};

export type ReceiveDeliveryInput = {
  readonly orderId: string;
  readonly lines: ReadonlyArray<ReceiveDeliveryLineInput>;
  readonly note?: string | null;
  readonly close?: boolean;
};

export type ReceivedDelivery = {
  readonly order: PurchaseOrderRow;
  readonly batches: ReadonlyArray<BatchRow>;
};

type RowProjection<Row> = {
  readonly writes: ReadonlyArray<CatalogRowWrite>;
  readonly row: Row;
};

type WriteProjection = {
  readonly writes: ReadonlyArray<CatalogRowWrite>;
};

const isSupplierPhone = Schema.is(SupplierPhone);

const supplierName = (value: string): Result.Result<string, CatalogRefusal> =>
  Result.gen(function* () {
    const name = value.trim();
    if (!name)
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "invalidInput",
          message: "Enter a supplier name.",
          field: "name",
        }),
      );
    if (name.length > MAX_NAME_LENGTH) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "invalidInput",
          message: `Keep the supplier name under ${MAX_NAME_LENGTH} characters.`,
          field: "name",
        }),
      );
    }
    return name;
  });

const supplierPhone = (
  value: string | null | undefined,
): Result.Result<string | null, CatalogRefusal> =>
  Result.gen(function* () {
    const digits = (value ?? "").replace(/\D/gu, "");
    if (digits === "") return null;
    if (!isSupplierPhone(digits))
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "invalidInput",
          message: "Enter a phone number of at most 20 digits.",
          field: "phone",
        }),
      );
    return digits;
  });

const noteOf = (value: string | null | undefined): Result.Result<string | null, CatalogRefusal> =>
  Result.gen(function* () {
    const note = (value ?? "").trim();
    if (note.length > MAX_NOTE_LENGTH) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "invalidInput",
          message: `Keep the note under ${MAX_NOTE_LENGTH} characters.`,
          field: "note",
        }),
      );
    }
    return note === "" ? null : note;
  });

const requireWholeNumber = (
  value: number,
  minimum: number,
  message: string,
  field?: string,
): Result.Result<number, CatalogRefusal> =>
  Result.gen(function* () {
    if (!Number.isSafeInteger(value) || value < minimum)
      return yield* Result.fail(
        field === undefined
          ? new CatalogRefusal({ reason: "invalidInput", message })
          : new CatalogRefusal({ reason: "invalidInput", message, field }),
      );
    return value;
  });

const timestampOf = (
  value: number | null | undefined,
  label: string,
  field?: string,
): Result.Result<number | null, CatalogRefusal> =>
  Result.gen(function* () {
    return value === null || value === undefined
      ? null
      : yield* requireWholeNumber(value, 1, `${label} is not a valid date.`, field);
  });

const priceOf = (
  value: number | null,
  label: string,
): Result.Result<number | null, CatalogRefusal> =>
  Result.gen(function* () {
    return value === null
      ? null
      : yield* requireWholeNumber(value, 0, `${label} must be zero or more.`);
  });

const created = (context: PurchasingProjectionContext) =>
  createdMutationMetadata(context.actor, commandIds(context));

const updated = (context: PurchasingProjectionContext, current: { readonly rowVersion: number }) =>
  updatedMutationMetadata(
    { ...context.actor, rowVersion: current.rowVersion },
    commandIds(context),
  );

const orderFieldsOf = (row: PurchaseOrderRow) => ({
  orderNumber: row.orderNumber,
  supplierId: row.supplierId,
  status: row.status,
  note: row.note,
  sentAt: row.sentAt,
  expectedAt: row.expectedAt,
  total: row.total,
});

type FieldValue = string | number | boolean | null;

const sameOn =
  <Key extends string>(...keys: ReadonlyArray<Key>) =>
  (left: Readonly<Record<Key, FieldValue>>, right: Readonly<Record<Key, FieldValue>>) =>
    keys.every((key) => left[key] === right[key]);

const sameSupplier = sameOn("name", "phone", "note");

const sameOrder = sameOn(
  "orderNumber",
  "supplierId",
  "status",
  "note",
  "sentAt",
  "expectedAt",
  "total",
);

const sameLine = sameOn(
  "purchaseOrderId",
  "productId",
  "productName",
  "quantity",
  "quantityType",
  "baseUnitQuantity",
  "packCost",
);

const samePrices = sameOn("purchasePrice", "retailPrice", "unitPrice");

const orderUpsert = (
  row: PurchaseOrderRow,
  expectedRowVersion: number | null,
): CatalogRowWrite => ({
  entity: "purchaseOrder",
  action: "upsert",
  id: row.id,
  expectedRowVersion,
  row: orderFieldsOf(row),
});

export const projectSaveSupplier = (
  context: PurchasingProjectionContext,
  input: SaveSupplierInput,
): Result.Result<RowProjection<SupplierRow>, CatalogRefusal> =>
  Result.gen(function* () {
    const name = yield* supplierName(input.name);
    const fields = {
      name,
      phone: yield* supplierPhone(input.phone),
      note: yield* noteOf(input.note),
    };
    const key = name.toLocaleLowerCase();
    const duplicate = [...context.tables.suppliers.state.values()].find(
      (supplier) => supplier.id !== input.id && supplier.name.trim().toLocaleLowerCase() === key,
    );
    if (duplicate)
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "duplicateName",
          message: `A supplier named “${duplicate.name}” already exists.`,
          field: "name",
        }),
      );
    if (input.id === undefined) {
      const row: SupplierRow = {
        id: decodeSupplierId(context.ids.rowId()),
        ...fields,
        ...created(context),
      };
      return {
        writes: [
          {
            entity: "supplier",
            action: "upsert",
            id: row.id,
            expectedRowVersion: null,
            row: fields,
          },
        ],
        row,
      };
    }
    const current = yield* requiredRow(
      context.tables.suppliers.state.get(input.id),
      "This supplier",
    );
    if (sameSupplier(fields, current)) return { writes: [], row: current };
    const row: SupplierRow = { ...current, ...fields, ...updated(context, current) };
    return {
      writes: [
        {
          entity: "supplier",
          action: "upsert",
          id: row.id,
          expectedRowVersion: current.rowVersion,
          row: fields,
        },
      ],
      row,
    };
  });

export const projectDeleteSupplier = (
  context: PurchasingProjectionContext,
  id: string,
): Result.Result<WriteProjection, CatalogRefusal> =>
  Result.gen(function* () {
    const current = yield* requiredRow(context.tables.suppliers.state.get(id), "This supplier");
    for (const order of context.tables.purchaseOrders.state.values()) {
      if (order.supplierId === current.id) {
        return yield* Result.fail(
          new CatalogRefusal({
            reason: "supplierHasOrders",
            message: purchasingRejection.supplierHasOrders.message,
          }),
        );
      }
    }
    return {
      writes: [
        {
          entity: "supplier",
          action: "delete",
          id: current.id,
          expectedRowVersion: current.rowVersion,
        },
      ],
    };
  });

const linesOfOrder = (
  context: PurchasingProjectionContext,
  orderId: string,
): ReadonlyArray<PurchaseOrderItemRow> =>
  [...context.tables.purchaseOrderItems.state.values()].filter(
    (line) => line.purchaseOrderId === orderId,
  );

type ProjectedLine = {
  readonly row: PurchaseOrderItemRow;
  readonly total: number | null;
  readonly write: CatalogRowWrite | undefined;
};

const projectLine = (
  context: PurchasingProjectionContext,
  order: PurchaseOrderRow,
  existing: PurchaseOrderItemRow | undefined,
  input: PurchaseOrderLineInput,
): Result.Result<ProjectedLine, CatalogRefusal> =>
  Result.gen(function* () {
    const product = yield* requiredRow(
      context.tables.products.state.get(input.productId),
      "This product",
    );
    const quantity = yield* requireWholeNumber(
      input.quantity,
      1,
      `Enter a whole quantity of at least 1 for ${product.name}.`,
    );
    const requestedCost =
      input.packCost === undefined
        ? existing
          ? existing.packCost
          : product.purchasePrice
        : input.packCost;
    const packCost = yield* priceOf(requestedCost, `The cost of ${product.name}`);
    if (existing && existing.receivedBaseUnits > 0 && existing.productId !== product.id) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "itemReceived",
          message: purchasingRejection.itemReceived.message,
        }),
      );
    }
    const fields = {
      purchaseOrderId: order.id,
      productId: product.id,
      productName: product.name,
      quantity,
      quantityType: input.quantityType,
      baseUnitQuantity: purchaseOrderLineBaseUnits(
        { quantity, quantityType: input.quantityType },
        product.unitsPerPack,
      ),
      packCost,
    };
    const total = purchaseOrderLineTotal(fields, product.unitsPerPack);
    if (existing && sameLine(fields, existing)) {
      return { row: existing, total, write: undefined };
    }
    const row: PurchaseOrderItemRow = existing
      ? { ...existing, ...fields, ...updated(context, existing) }
      : {
          id: decodePurchaseOrderItemId(context.ids.rowId()),
          ...fields,
          receivedBaseUnits: 0,
          ...created(context),
        };
    return {
      row,
      total,
      write: {
        entity: "purchaseOrderItem",
        action: "upsert",
        id: row.id,
        expectedRowVersion: existing ? existing.rowVersion : null,
        row: fields,
      },
    };
  });

export const projectSaveOrderDraft = (
  context: PurchasingProjectionContext,
  input: SaveOrderDraftInput,
  proposedOrderNumber: number,
): Result.Result<RowProjection<SavedPurchaseOrder>, CatalogRefusal> =>
  Result.gen(function* () {
    const current =
      input.id === undefined
        ? undefined
        : yield* requiredRow(
            context.tables.purchaseOrders.state.get(input.id),
            "This purchase order",
          );
    if (current && !isPurchaseOrderOpen(current.status)) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "orderNotOpen",
          message: purchasingRejection.orderNotOpen.message,
        }),
      );
    }
    const supplier = context.tables.suppliers.state.get(input.supplierId);
    if (!supplier)
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "missingReference",
          message: "Select a supplier for this order.",
          field: "supplierId",
        }),
      );
    if (input.send === true && input.lines.length === 0) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "emptyCommand",
          message: "Add at least one line before sending this order.",
        }),
      );
    }
    const saved: PurchaseOrderRow = current ?? {
      id: decodePurchaseOrderId(context.ids.rowId()),
      orderNumber: proposedOrderNumber,
      supplierId: supplier.id,
      status: "draft",
      note: null,
      sentAt: null,
      expectedAt: null,
      total: 0,
      ...created(context),
    };
    const stored = new Map<string, PurchaseOrderItemRow>(
      linesOfOrder(context, saved.id).map((line) => [line.id, line]),
    );
    const kept = new Set<string>();
    const lines: Array<ProjectedLine> = [];
    for (const line of input.lines) {
      const existing = line.id === undefined ? undefined : stored.get(line.id);
      if (line.id !== undefined && (!existing || kept.has(existing.id))) {
        return yield* Result.fail(
          new CatalogRefusal({
            reason: "staleRow",
            message: "An order line changed on another device. Reopen the order and try again.",
          }),
        );
      }
      if (existing) kept.add(existing.id);
      lines.push(yield* projectLine(context, saved, existing, line));
    }
    const removals: Array<CatalogRowWrite> = [];
    for (const line of stored.values()) {
      if (kept.has(line.id)) continue;
      if (line.receivedBaseUnits > 0)
        return yield* Result.fail(
          new CatalogRefusal({
            reason: "itemReceived",
            message: purchasingRejection.itemReceived.message,
          }),
        );
      removals.push({
        entity: "purchaseOrderItem",
        action: "delete",
        id: line.id,
        expectedRowVersion: line.rowVersion,
      });
    }
    const fields = {
      ...orderFieldsOf(saved),
      supplierId: supplier.id,
      note: yield* noteOf(input.note),
      expectedAt: yield* timestampOf(input.expectedAt, "The expected date", "expectedAt"),
      total: purchaseOrderTotal(lines.map((line) => line.total)),
    };
    const sending = input.send === true && saved.status === "draft";
    const sent = { status: "sent", sentAt: context.occurredAt } as const;
    const drafted: PurchaseOrderRow = current
      ? { ...current, ...fields, ...(sending ? sent : null) }
      : { ...saved, ...fields };
    const orderWrites: ReadonlyArray<CatalogRowWrite> = current
      ? sameOrder(drafted, current)
        ? []
        : [orderUpsert(drafted, current.rowVersion)]
      : [orderUpsert(drafted, null)];
    const order: PurchaseOrderRow = current
      ? orderWrites.length === 0
        ? current
        : { ...drafted, ...updated(context, current) }
      : { ...drafted, ...(sending ? sent : null) };
    const writes: ReadonlyArray<CatalogRowWrite> = [
      ...orderWrites,
      ...removals,
      ...lines.flatMap((line) => (line.write ? [line.write] : [])),
      ...(sending && !current ? [orderUpsert(order, order.rowVersion)] : []),
    ];
    if (writes.length > MAX_CATALOG_WRITE_ROWS) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "tooManyLines",
          message: "This order has too many changed lines to save at once.",
        }),
      );
    }
    return { writes, row: { order, lines: lines.map((line) => line.row) } };
  });

const moveOrder = (
  context: PurchasingProjectionContext,
  id: string,
  status: Exclude<PurchaseOrderStatus, "draft">,
  refusal: string,
): Result.Result<RowProjection<PurchaseOrderRow>, CatalogRefusal> =>
  Result.gen(function* () {
    const current = yield* requiredRow(
      context.tables.purchaseOrders.state.get(id),
      "This purchase order",
    );
    if (current.status === status) return { writes: [], row: current };
    if (!isPurchaseOrderOpen(current.status)) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "orderNotOpen",
          message: purchasingRejection.orderNotOpen.message,
        }),
      );
    }
    if (!canMovePurchaseOrder(current.status, status))
      return yield* Result.fail(
        new CatalogRefusal({ reason: "orderTransitionInvalid", message: refusal }),
      );
    const moved: PurchaseOrderRow = {
      ...current,
      status,
      sentAt: status === "sent" ? context.occurredAt : current.sentAt,
    };
    return {
      writes: [orderUpsert(moved, current.rowVersion)],
      row: { ...moved, ...updated(context, current) },
    };
  });

export const projectSendOrder = (
  context: PurchasingProjectionContext,
  id: string,
): Result.Result<RowProjection<PurchaseOrderRow>, CatalogRefusal> =>
  Result.gen(function* () {
    const projected = yield* moveOrder(
      context,
      id,
      "sent",
      purchasingRejection.orderTransitionInvalid.message,
    );
    if (projected.writes.length > 0 && linesOfOrder(context, projected.row.id).length === 0) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "emptyCommand",
          message: "Add at least one line before sending this order.",
        }),
      );
    }
    return projected;
  });

export const projectCloseOrder = (
  context: PurchasingProjectionContext,
  id: string,
): Result.Result<RowProjection<PurchaseOrderRow>, CatalogRefusal> =>
  moveOrder(context, id, "closed", "Send this order before closing it.");

export const projectCancelOrder = (
  context: PurchasingProjectionContext,
  id: string,
): Result.Result<RowProjection<PurchaseOrderRow>, CatalogRefusal> =>
  moveOrder(context, id, "cancelled", purchasingRejection.orderTransitionInvalid.message);

const pricedProduct = (
  product: ProductRow,
  line: ReceiveDeliveryLineInput,
): Result.Result<ProductRow, CatalogRefusal> =>
  Result.gen(function* () {
    return {
      ...product,
      purchasePrice:
        line.purchasePrice === undefined
          ? product.purchasePrice
          : yield* priceOf(line.purchasePrice, `The purchase price of ${product.name}`),
      retailPrice:
        line.retailPrice === undefined
          ? product.retailPrice
          : yield* priceOf(line.retailPrice, `The retail price of ${product.name}`),
      unitPrice:
        line.unitPrice === undefined
          ? product.unitPrice
          : yield* priceOf(line.unitPrice, `The unit price of ${product.name}`),
    };
  });

export const projectReceiveDelivery = (
  context: PurchasingProjectionContext,
  input: ReceiveDeliveryInput,
): Result.Result<RowProjection<ReceivedDelivery>, CatalogRefusal> =>
  Result.gen(function* () {
    const current = yield* requiredRow(
      context.tables.purchaseOrders.state.get(input.orderId),
      "This purchase order",
    );
    if (!isPurchaseOrderOpen(current.status)) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "orderNotOpen",
          message: purchasingRejection.orderNotOpen.message,
        }),
      );
    }
    const note =
      (yield* noteOf(input.note)) ?? `Purchase order #${formatInvoiceNumber(current.orderNumber)}`;
    const priced = new Map<string, ProductRow>();
    const batches: Array<BatchRow> = [];
    const receipts: Array<CatalogRowWrite> = [];
    for (const received of input.lines) {
      const line = yield* requiredRow(
        context.tables.purchaseOrderItems.state.get(received.purchaseOrderItemId),
        "This order line",
      );
      if (line.purchaseOrderId !== current.id) {
        return yield* Result.fail(
          new CatalogRefusal({
            reason: "lineBelongsElsewhere",
            message: "This line belongs to a different purchase order.",
          }),
        );
      }
      const stored = yield* requiredRow(
        context.tables.products.state.get(line.productId),
        "This product",
      );
      const packQuantity = yield* requireWholeNumber(
        received.packQuantity ?? 0,
        0,
        "Pack quantity must be a non-negative whole number.",
      );
      const unitQuantity = yield* requireWholeNumber(
        received.unitQuantity ?? 0,
        0,
        "Unit quantity must be a non-negative whole number.",
      );
      if (packQuantity === 0 && unitQuantity === 0) continue;
      const product = yield* pricedProduct(priced.get(stored.id) ?? stored, received);
      if (!samePrices(product, stored)) {
        priced.set(stored.id, product);
      }
      const batch: BatchRow = {
        id: decodeBatchId(context.ids.rowId()),
        productId: stored.id,
        batchNumber: received.batchNumber?.trim() || null,
        expiresAt: yield* timestampOf(received.expiresAt, "The expiry date"),
        packQuantity,
        unitQuantity,
        ...created(context),
      };
      batches.push(batch);
      receipts.push({
        entity: "batch",
        action: "upsert",
        id: batch.id,
        expectedRowVersion: null,
        movementId: context.ids.rowId(),
        note,
        row: {
          productId: batch.productId,
          batchNumber: batch.batchNumber,
          expiresAt: batch.expiresAt,
          packQuantity,
          unitQuantity,
        },
        receipt: { purchaseOrderItemId: line.id },
      });
    }
    if (receipts.length === 0) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "emptyCommand",
          message: "Enter a received quantity for at least one line.",
        }),
      );
    }
    const sent: PurchaseOrderRow =
      current.status === "draft"
        ? { ...current, status: "sent", sentAt: context.occurredAt }
        : current;
    const closed: PurchaseOrderRow = input.close === true ? { ...sent, status: "closed" } : sent;
    const writes: ReadonlyArray<CatalogRowWrite> = [
      ...(sent === current ? [] : [orderUpsert(sent, current.rowVersion)]),
      ...[...priced.values()].map((product): CatalogRowWrite => ({
        entity: "product",
        action: "upsert",
        id: product.id,
        expectedRowVersion: product.rowVersion,
        row: productFieldsOf(product),
      })),
      ...receipts,
      ...(closed === sent ? [] : [orderUpsert(closed, current.rowVersion)]),
    ];
    if (writes.length > MAX_CATALOG_WRITE_ROWS) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "tooManyLines",
          message: "This delivery has too many lines to save at once.",
        }),
      );
    }
    return {
      writes,
      row: {
        order: closed === current ? current : { ...closed, ...updated(context, current) },
        batches,
      },
    };
  });
