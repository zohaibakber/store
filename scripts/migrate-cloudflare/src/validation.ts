import type { OrganizationId } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ValidationFailed } from "./errors.ts";
import { addAggregate, emptyAggregates, rowsChecksum } from "./mapping.ts";
import {
  BUSINESS_TABLES,
  type OrganizationManifest,
  SqliteBatch as SqliteBatchSchema,
  SqliteInvoice as SqliteInvoiceSchema,
  SqliteInvoiceItem as SqliteInvoiceItemSchema,
  SqliteProduct as SqliteProductSchema,
  SqliteStockMovement as SqliteStockMovementSchema,
} from "./model.ts";
import type { OrganizationInventoryImport } from "./target.ts";

const idsOf = (rows: ReadonlyArray<{ readonly id: string }>): ReadonlySet<string> =>
  new Set(rows.map((row) => row.id));

const fail = (
  organizationId: OrganizationId,
  message: string,
): Effect.Effect<never, ValidationFailed> =>
  Effect.fail(
    new ValidationFailed({
      organizationId,
      incompleteStep: "validateRecords",
      message,
    }),
  );

export const validateOrganization = (
  target: OrganizationInventoryImport["Service"],
  organizationId: OrganizationId,
  expected: OrganizationManifest,
): Effect.Effect<void, ValidationFailed> =>
  Effect.gen(function* () {
    const tables = {
      categories: yield* target.readTable(organizationId, "categories"),
      products: yield* target.readTable(organizationId, "products"),
      batches: yield* target.readTable(organizationId, "batches"),
      invoices: yield* target.readTable(organizationId, "invoices"),
      invoice_items: yield* target.readTable(organizationId, "invoice_items"),
      stock_movements: yield* target.readTable(organizationId, "stock_movements"),
    };
    let aggregates = emptyAggregates();
    for (const table of BUSINESS_TABLES) {
      const rows = tables[table];
      const owned = rows.every((row) => row.organizationId === organizationId);
      if (!owned) {
        return yield* fail(
          organizationId,
          `Table ${table} contains a row owned by another organization.`,
        );
      }
      const listed = expected.tables.find((entry) => entry.table === table);
      if (listed === undefined) {
        return yield* fail(organizationId, `Manifest is missing table ${table}.`);
      }
      if (listed.rowCount !== rows.length) {
        return yield* fail(
          organizationId,
          `Table ${table} row count ${String(rows.length)} does not match manifest ${String(listed.rowCount)}.`,
        );
      }
      const checksum = rowsChecksum(rows);
      if (checksum !== listed.checksum) {
        return yield* fail(
          organizationId,
          `Table ${table} checksum ${checksum} does not match manifest ${listed.checksum}.`,
        );
      }
      aggregates = addAggregate(aggregates, table, rows);
    }
    if (
      aggregates.invoiceTotalSum !== expected.aggregates.invoiceTotalSum ||
      aggregates.batchPackQuantitySum !== expected.aggregates.batchPackQuantitySum ||
      aggregates.batchUnitQuantitySum !== expected.aggregates.batchUnitQuantitySum ||
      aggregates.movementPackDeltaSum !== expected.aggregates.movementPackDeltaSum ||
      aggregates.movementUnitDeltaSum !== expected.aggregates.movementUnitDeltaSum
    ) {
      return yield* fail(organizationId, "Aggregate validation values do not match the manifest.");
    }
    const products = tables.products.filter(Schema.is(SqliteProductSchema));
    const batches = tables.batches.filter(Schema.is(SqliteBatchSchema));
    const invoices = tables.invoices.filter(Schema.is(SqliteInvoiceSchema));
    const items = tables.invoice_items.filter(Schema.is(SqliteInvoiceItemSchema));
    const movements = tables.stock_movements.filter(Schema.is(SqliteStockMovementSchema));
    const categoryIds = idsOf(tables.categories);
    const productIds = idsOf(products);
    const batchIds = idsOf(batches);
    const invoiceIds = idsOf(invoices);
    for (const product of products) {
      if (!categoryIds.has(product.categoryId)) {
        return yield* fail(
          organizationId,
          `Product ${product.id} references missing category ${product.categoryId}.`,
        );
      }
    }
    for (const batch of batches) {
      if (!productIds.has(batch.productId)) {
        return yield* fail(
          organizationId,
          `Batch ${batch.id} references missing product ${batch.productId}.`,
        );
      }
    }
    for (const item of items) {
      if (
        !invoiceIds.has(item.invoiceId) ||
        !productIds.has(item.productId) ||
        !batchIds.has(item.batchId)
      ) {
        return yield* fail(organizationId, `Invoice item ${item.id} has a broken foreign key.`);
      }
    }
    for (const movement of movements) {
      if (!productIds.has(movement.productId) || !batchIds.has(movement.batchId)) {
        return yield* fail(
          organizationId,
          `Stock movement ${movement.id} has a broken foreign key.`,
        );
      }
      if (movement.invoiceId !== null && !invoiceIds.has(movement.invoiceId)) {
        return yield* fail(
          organizationId,
          `Stock movement ${movement.id} references missing invoice ${movement.invoiceId}.`,
        );
      }
    }
    for (const invoice of invoices) {
      const total = items
        .filter((item) => item.invoiceId === invoice.id)
        .reduce((sum, item) => sum + item.quantity * item.salePrice, 0);
      if (total !== invoice.total) {
        return yield* fail(
          organizationId,
          `Invoice ${invoice.id} total ${String(invoice.total)} does not equal line sum ${String(total)}.`,
        );
      }
    }
    for (const batch of batches) {
      const pack = movements
        .filter((movement) => movement.batchId === batch.id)
        .reduce((sum, movement) => sum + movement.packDelta, 0);
      const unit = movements
        .filter((movement) => movement.batchId === batch.id)
        .reduce((sum, movement) => sum + movement.unitDelta, 0);
      if (pack !== batch.packQuantity || unit !== batch.unitQuantity) {
        return yield* fail(
          organizationId,
          `Batch ${batch.id} quantities are not conserved by stock movements.`,
        );
      }
    }
    const replicaCount = yield* target.countReplicas(organizationId);
    const receiptCount = yield* target.countReceipts(organizationId);
    if (replicaCount !== 0 || receiptCount !== 0) {
      return yield* fail(
        organizationId,
        "Imported organizations must start with no replica registrations or receipts.",
      );
    }
  }).pipe(
    Effect.mapError((error) => {
      if (error instanceof ValidationFailed) return error;
      return new ValidationFailed({
        organizationId,
        incompleteStep: "validateRecords",
        message: "Validation could not read the imported organization.",
      });
    }),
  );
