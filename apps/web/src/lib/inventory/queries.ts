import type {
  Category,
  Invoice,
  Product,
  ProductSuggestions,
  StockMovement,
} from "@store/contracts";
import { and, eq, isNull, toArray, useLiveQuery } from "@tanstack/react-db";

import { useCatalogReplica } from "./provider";

export const useCatalogCategories = () => {
  const inventory = useCatalogReplica();
  const live = useLiveQuery(
    (query) =>
      query
        .from({ category: inventory.categories })
        .where(({ category }) => isNull(category.deletedAt))
        .orderBy(({ category }) => category.name, "asc")
        .select(({ category }) => ({
          id: category.id,
          name: category.name,
          tracksPacks: category.tracksPacks,
          organizationId: category.organizationId,
          createdByUserId: category.createdByUserId,
          updatedByUserId: category.updatedByUserId,
          deviceId: category.deviceId,
          operationId: category.operationId,
          rowVersion: category.rowVersion,
          createdAt: category.createdAt,
          updatedAt: category.updatedAt,
        })),
    [inventory],
  );
  const data: ReadonlyArray<Category> = live.data;
  return { ...live, data };
};

export const useCatalogProducts = () => {
  const inventory = useCatalogReplica();
  const live = useLiveQuery(
    (query) =>
      query
        .from({ product: inventory.products })
        .innerJoin({ category: inventory.categories }, ({ product, category }) =>
          eq(product.categoryId, category.id),
        )
        .where(({ product, category }) =>
          and(isNull(product.deletedAt), isNull(category.deletedAt)),
        )
        .orderBy(({ product }) => product.name, "asc")
        .select(({ product, category }) => ({
          id: product.id,
          name: product.name,
          categoryId: product.categoryId,
          aisle: product.aisle,
          composition: product.composition,
          strength: product.strength,
          unitsPerPack: product.unitsPerPack,
          packPrice: product.packPrice,
          unitPrice: product.unitPrice,
          visible: product.visible,
          organizationId: product.organizationId,
          createdByUserId: product.createdByUserId,
          updatedByUserId: product.updatedByUserId,
          deviceId: product.deviceId,
          operationId: product.operationId,
          rowVersion: product.rowVersion,
          createdAt: product.createdAt,
          updatedAt: product.updatedAt,
          category: {
            id: category.id,
            name: category.name,
            tracksPacks: category.tracksPacks,
            organizationId: category.organizationId,
            createdByUserId: category.createdByUserId,
            updatedByUserId: category.updatedByUserId,
            deviceId: category.deviceId,
            operationId: category.operationId,
            rowVersion: category.rowVersion,
            createdAt: category.createdAt,
            updatedAt: category.updatedAt,
          },
          batches: toArray(
            query
              .from({ batch: inventory.batches })
              .where(({ batch }) => and(eq(batch.productId, product.id), isNull(batch.deletedAt)))
              .select(({ batch }) => ({
                id: batch.id,
                productId: batch.productId,
                batchNumber: batch.batchNumber,
                expiresAt: batch.expiresAt,
                packQuantity: batch.packQuantity,
                unitQuantity: batch.unitQuantity,
                organizationId: batch.organizationId,
                createdByUserId: batch.createdByUserId,
                updatedByUserId: batch.updatedByUserId,
                deviceId: batch.deviceId,
                operationId: batch.operationId,
                rowVersion: batch.rowVersion,
                createdAt: batch.createdAt,
                updatedAt: batch.updatedAt,
              })),
          ),
        })),
    [inventory],
  );
  const data: ReadonlyArray<Product> = live.data;
  return { ...live, data };
};

export const useCatalogProduct = (productId: string) => {
  const live = useCatalogProducts();
  return { ...live, data: live.data.find((product) => product.id === productId) };
};

export const useCatalogStockMovements = (productId: string) => {
  const inventory = useCatalogReplica();
  const live = useLiveQuery(
    (query) =>
      query
        .from({ movement: inventory.stockMovements })
        .where(({ movement }) => eq(movement.productId, productId))
        .orderBy(({ movement }) => movement.createdAt, "desc")
        .select(({ movement }) => ({
          id: movement.id,
          productId: movement.productId,
          batchId: movement.batchId,
          invoiceId: movement.invoiceId,
          type: movement.type,
          packDelta: movement.packDelta,
          unitDelta: movement.unitDelta,
          note: movement.note,
          organizationId: movement.organizationId,
          actorUserId: movement.actorUserId,
          deviceId: movement.deviceId,
          operationId: movement.operationId,
          createdAt: movement.createdAt,
        })),
    [inventory, productId],
  );
  const data: ReadonlyArray<StockMovement> = live.data;
  return { ...live, data };
};

export const useInventoryInvoices = () => {
  const inventory = useCatalogReplica();
  const live = useLiveQuery(
    (query) =>
      query
        .from({ invoice: inventory.invoices })
        .where(({ invoice }) => isNull(invoice.deletedAt))
        .orderBy(({ invoice }) => invoice.createdAt, "desc")
        .select(({ invoice }) => ({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerName: invoice.customerName,
          total: invoice.total,
          organizationId: invoice.organizationId,
          createdByUserId: invoice.createdByUserId,
          updatedByUserId: invoice.updatedByUserId,
          deviceId: invoice.deviceId,
          operationId: invoice.operationId,
          rowVersion: invoice.rowVersion,
          createdAt: invoice.createdAt,
          updatedAt: invoice.updatedAt,
          items: toArray(
            query
              .from({ item: inventory.invoiceItems })
              .where(({ item }) => and(eq(item.invoiceId, invoice.id), isNull(item.deletedAt)))
              .select(({ item }) => ({
                id: item.id,
                invoiceId: item.invoiceId,
                productId: item.productId,
                batchId: item.batchId,
                productName: item.productName,
                batchNumber: item.batchNumber,
                quantity: item.quantity,
                quantityType: item.quantityType,
                baseUnitQuantity: item.baseUnitQuantity,
                salePrice: item.salePrice,
                organizationId: item.organizationId,
                createdByUserId: item.createdByUserId,
                updatedByUserId: item.updatedByUserId,
                deviceId: item.deviceId,
                operationId: item.operationId,
                rowVersion: item.rowVersion,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
              })),
          ),
        })),
    [inventory],
  );
  const data: ReadonlyArray<Invoice> = live.data;
  return { ...live, data };
};

export const useInventoryInvoice = (invoiceId: string) => {
  const live = useInventoryInvoices();
  return { ...live, data: live.data.find((invoice) => invoice.id === invoiceId) };
};

export const useCatalogSuggestions = (): ProductSuggestions => {
  const products = useCatalogProducts().data;
  const distinct = (values: ReadonlyArray<string | null>) =>
    [...new Set(values.flatMap((value) => (value?.trim() ? [value.trim()] : [])))].sort((a, b) =>
      a.localeCompare(b),
    );
  return {
    names: distinct(products.map((product) => product.name)),
    aisles: distinct(products.map((product) => product.aisle)),
    compositions: distinct(products.map((product) => product.composition)),
  };
};
