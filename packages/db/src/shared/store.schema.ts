import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { nanoid } from "nanoid";

const epochMilliseconds = () => integer({ mode: "number" });

const timestamps = {
  createdAt: epochMilliseconds().notNull(),
  updatedAt: epochMilliseconds().notNull(),
};

const tenantId = () => text().notNull();

const entityId = () =>
  text()
    .notNull()
    .$defaultFn(() => nanoid());

const mutableSyncMetadata = {
  organizationId: tenantId(),
  createdByUserId: text().notNull(),
  updatedByUserId: text().notNull(),
  deviceId: text().notNull(),
  operationId: text().notNull(),
  rowVersion: epochMilliseconds().notNull().default(1),
};

export const categories = sqliteTable(
  "categories",
  {
    id: entityId(),
    name: text().notNull(),
    tracksPacks: integer({ mode: "boolean" }).notNull().default(true),
    ...timestamps,
    ...mutableSyncMetadata,
  },
  (table) => [
    primaryKey({
      name: "categories_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    uniqueIndex("categories_organization_id_name_uidx").on(table.organizationId, table.name),
    index("categories_organization_id_updated_at_idx").on(table.organizationId, table.updatedAt),
  ],
);

export const products = sqliteTable(
  "products",
  {
    id: entityId(),
    name: text().notNull(),
    categoryId: text().notNull().default("general"),
    aisle: text(),
    composition: text(),
    strength: text(),
    unitsPerPack: integer().notNull().default(1),
    purchasePrice: integer(),
    retailPrice: integer(),
    unitPrice: integer(),
    visible: integer({ mode: "boolean" }).notNull().default(true),
    ...timestamps,
    ...mutableSyncMetadata,
  },
  (table) => [
    primaryKey({
      name: "products_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    index("products_organization_id_category_id_idx").on(table.organizationId, table.categoryId),
    index("products_organization_id_updated_at_idx").on(table.organizationId, table.updatedAt),
  ],
);

export const batches = sqliteTable(
  "batches",
  {
    id: entityId(),
    productId: text().notNull(),
    batchNumber: text(),
    expiresAt: epochMilliseconds(),
    packQuantity: integer().notNull().default(0),
    unitQuantity: integer().notNull().default(0),
    ...timestamps,
    ...mutableSyncMetadata,
  },
  (table) => [
    primaryKey({
      name: "batches_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    index("batches_organization_id_product_id_idx").on(table.organizationId, table.productId),
    index("batches_organization_id_product_expiry_idx").on(
      table.organizationId,
      table.productId,
      table.expiresAt,
    ),
  ],
);

export const invoices = sqliteTable(
  "invoices",
  {
    id: entityId(),
    invoiceNumber: integer().notNull(),
    customerName: text(),
    total: integer().notNull().default(0),
    ...timestamps,
    ...mutableSyncMetadata,
  },
  (table) => [
    primaryKey({
      name: "invoices_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    uniqueIndex("invoices_organization_id_invoice_number_uidx").on(
      table.organizationId,
      table.invoiceNumber,
    ),
    uniqueIndex("invoices_organization_id_operation_id_uidx").on(
      table.organizationId,
      table.operationId,
    ),
    index("invoices_organization_id_created_at_idx").on(table.organizationId, table.createdAt),
    check("invoices_invoice_number_positive", sql`${table.invoiceNumber} > 0`),
  ],
);

export const invoiceItems = sqliteTable(
  "invoice_items",
  {
    id: entityId(),
    invoiceId: text().notNull(),
    productId: text().notNull(),
    batchId: text().notNull(),
    productName: text().notNull(),
    batchNumber: text(),
    quantity: integer().notNull(),
    quantityType: text().$type<"unit" | "pack">().notNull().default("unit"),
    baseUnitQuantity: integer().notNull(),
    salePrice: integer().notNull(),
    ...timestamps,
    ...mutableSyncMetadata,
  },
  (table) => [
    primaryKey({
      name: "invoice_items_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    index("invoice_items_organization_id_invoice_id_idx").on(table.organizationId, table.invoiceId),
  ],
);

export const suppliers = sqliteTable(
  "suppliers",
  {
    id: entityId(),
    name: text().notNull(),
    phone: text(),
    note: text(),
    ...timestamps,
    ...mutableSyncMetadata,
  },
  (table) => [
    primaryKey({
      name: "suppliers_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    uniqueIndex("suppliers_organization_id_name_uidx").on(table.organizationId, table.name),
    index("suppliers_organization_id_updated_at_idx").on(table.organizationId, table.updatedAt),
  ],
);

export const purchaseOrders = sqliteTable(
  "purchase_orders",
  {
    id: entityId(),
    orderNumber: integer().notNull(),
    supplierId: text().notNull(),
    status: text().$type<"draft" | "sent" | "closed" | "cancelled">().notNull().default("draft"),
    note: text(),
    sentAt: epochMilliseconds(),
    expectedAt: epochMilliseconds(),
    total: integer().notNull().default(0),
    ...timestamps,
    ...mutableSyncMetadata,
  },
  (table) => [
    primaryKey({
      name: "purchase_orders_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    uniqueIndex("purchase_orders_organization_id_order_number_uidx").on(
      table.organizationId,
      table.orderNumber,
    ),
    index("purchase_orders_organization_id_supplier_id_idx").on(
      table.organizationId,
      table.supplierId,
    ),
    index("purchase_orders_organization_id_status_created_at_idx").on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    check("purchase_orders_order_number_positive", sql`${table.orderNumber} > 0`),
    check(
      "purchase_orders_status",
      sql`${table.status} in ('draft', 'sent', 'closed', 'cancelled')`,
    ),
  ],
);

export const purchaseOrderItems = sqliteTable(
  "purchase_order_items",
  {
    id: entityId(),
    purchaseOrderId: text().notNull(),
    productId: text().notNull(),
    productName: text().notNull(),
    quantity: integer().notNull(),
    quantityType: text().$type<"unit" | "pack">().notNull().default("pack"),
    baseUnitQuantity: integer().notNull(),
    packCost: integer(),
    receivedBaseUnits: integer().notNull().default(0),
    ...timestamps,
    ...mutableSyncMetadata,
  },
  (table) => [
    primaryKey({
      name: "purchase_order_items_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    index("purchase_order_items_organization_id_purchase_order_id_idx").on(
      table.organizationId,
      table.purchaseOrderId,
    ),
    index("purchase_order_items_organization_id_product_id_idx").on(
      table.organizationId,
      table.productId,
    ),
  ],
);

export const stockMovements = sqliteTable(
  "stock_movements",
  {
    id: entityId(),
    productId: text().notNull(),
    batchId: text().notNull(),
    invoiceId: text(),
    purchaseOrderId: text(),
    type: text().$type<"stock_in" | "sale" | "open_pack" | "adjustment">().notNull(),
    packDelta: integer().notNull().default(0),
    unitDelta: integer().notNull().default(0),
    note: text(),
    organizationId: tenantId(),
    actorUserId: text().notNull(),
    deviceId: text().notNull(),
    operationId: text().notNull(),
    createdAt: epochMilliseconds().notNull(),
  },
  (table) => [
    primaryKey({
      name: "stock_movements_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    index("stock_movements_organization_id_product_id_idx").on(
      table.organizationId,
      table.productId,
    ),
    index("stock_movements_organization_id_batch_id_idx").on(table.organizationId, table.batchId),
    index("stock_movements_organization_id_invoice_id_idx").on(
      table.organizationId,
      table.invoiceId,
    ),
    index("stock_movements_organization_id_operation_id_idx").on(
      table.organizationId,
      table.operationId,
    ),
    index("stock_movements_organization_id_purchase_order_id_idx")
      .on(table.organizationId, table.purchaseOrderId)
      .where(sql`${table.purchaseOrderId} is not null`),
  ],
);
