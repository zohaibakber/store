import type { AbstractPowerSyncDatabase } from "@powersync/common";
import { powerSyncCollectionOptions } from "@tanstack/powersync-db-collection";

import {
  inventoryPowerSyncSchema,
  powerSyncCollectionSchemas,
  powerSyncDeserializationFailure,
  powerSyncDeserializationSchemas,
} from "./powersync";

const sqliteBoolean = (value: boolean) => (value ? 1 : 0);

export const inventoryPowerSyncCollectionConfigs = (
  database: AbstractPowerSyncDatabase,
  scopeId: string,
) => ({
  categories: powerSyncCollectionOptions({
    id: `${scopeId}:categories`,
    database,
    table: inventoryPowerSyncSchema.props.categories,
    schema: powerSyncCollectionSchemas.categories,
    deserializationSchema: powerSyncDeserializationSchemas.categories,
    onDeserializationError: powerSyncDeserializationFailure,
    serializer: { tracksPacks: sqliteBoolean },
  }),
  products: powerSyncCollectionOptions({
    id: `${scopeId}:products`,
    database,
    table: inventoryPowerSyncSchema.props.products,
    schema: powerSyncCollectionSchemas.products,
    deserializationSchema: powerSyncDeserializationSchemas.products,
    onDeserializationError: powerSyncDeserializationFailure,
    serializer: { visible: sqliteBoolean },
  }),
  batches: powerSyncCollectionOptions({
    id: `${scopeId}:batches`,
    database,
    table: inventoryPowerSyncSchema.props.batches,
    schema: powerSyncCollectionSchemas.batches,
    deserializationSchema: powerSyncDeserializationSchemas.batches,
    onDeserializationError: powerSyncDeserializationFailure,
  }),
  invoices: powerSyncCollectionOptions({
    id: `${scopeId}:invoices`,
    database,
    table: inventoryPowerSyncSchema.props.invoices,
    schema: powerSyncCollectionSchemas.invoices,
    deserializationSchema: powerSyncDeserializationSchemas.invoices,
    onDeserializationError: powerSyncDeserializationFailure,
  }),
  invoiceItems: powerSyncCollectionOptions({
    id: `${scopeId}:invoice-items`,
    database,
    table: inventoryPowerSyncSchema.props.invoice_items,
    schema: powerSyncCollectionSchemas.invoiceItems,
    deserializationSchema: powerSyncDeserializationSchemas.invoiceItems,
    onDeserializationError: powerSyncDeserializationFailure,
  }),
  stockMovements: powerSyncCollectionOptions({
    id: `${scopeId}:stock-movements`,
    database,
    table: inventoryPowerSyncSchema.props.stock_movements,
    schema: powerSyncCollectionSchemas.stockMovements,
    deserializationSchema: powerSyncDeserializationSchemas.stockMovements,
    onDeserializationError: powerSyncDeserializationFailure,
  }),
});
