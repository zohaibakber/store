import { PowerSyncDatabase } from "@powersync/react-native";
import {
  inventoryPowerSyncSchema,
  openCatalog,
  type BatchRow,
  type CatalogCollectionConfigs,
  type CategoryRow,
  type InvoiceItemRow,
  type InvoiceRow,
  type ProductRow,
  type StockMovementRow,
} from "@store/client-db";
import { createCollection, type Collection, type NonSingleResult } from "@tanstack/react-db";

import { apiOrigin, nativeAuthHeaders } from "@/lib/auth-client";

const authenticatedFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(await nativeAuthHeaders())) {
    headers.set(name, value);
  }
  return fetch(input, { ...init, headers });
};

type InventoryCollectionConfig = CatalogCollectionConfigs[keyof CatalogCollectionConfigs];
type CatalogCollection<Row extends object> = Collection<Row, string> & NonSingleResult;

const catalogCollection = <Row extends object>(
  options: InventoryCollectionConfig,
): CatalogCollection<Row> => {
  // SAFETY: Runtime value is powerSyncCollectionOptions output. Expo TypeScript
  // and workspace TypeScript load separate @tanstack/db copies, so CollectionConfig
  // from client-db is not assignable to createCollection here.
  return createCollection(options as never) as CatalogCollection<Row>;
};

export type MobileInventoryCollections = Awaited<ReturnType<typeof openMobileCatalog>>;

export const openMobileCatalog = (organizationId: string) =>
  openCatalog(
    {
      apiBaseUrl: apiOrigin,
      authenticatedFetch,
      openPowerSyncDatabase: async (databaseName) => {
        const database = new PowerSyncDatabase({
          database: { dbFilename: databaseName },
          schema: inventoryPowerSyncSchema,
        });
        await database.init();
        return database;
      },
      bindCollections: (configs) => {
        const batches = catalogCollection<BatchRow>(configs.batches);
        const categories = catalogCollection<CategoryRow>(configs.categories);
        const products = catalogCollection<ProductRow>(configs.products);
        const invoices = catalogCollection<InvoiceRow>(configs.invoices);
        const invoiceItems = catalogCollection<InvoiceItemRow>(configs.invoiceItems);
        const stockMovements = catalogCollection<StockMovementRow>(configs.stockMovements);
        return {
          batches,
          categories,
          products,
          invoices,
          invoiceItems,
          stockMovements,
          cleanupCollections: async () => {
            await Promise.all([
              batches.cleanup(),
              categories.cleanup(),
              products.cleanup(),
              invoices.cleanup(),
              invoiceItems.cleanup(),
              stockMovements.cleanup(),
            ]);
          },
        };
      },
    },
    organizationId,
    { waitForFirstSync: true },
  );
