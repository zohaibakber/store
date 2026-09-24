import { useAtomValue } from "@effect/atom-react";
import type { ProductRow } from "@store/client-db";
import type {
  Category,
  Invoice,
  Product,
  ProductSuggestions,
  StockMovement,
  SyncEntity,
} from "@store/contracts";
import {
  eq,
  inArray,
  or,
  toArray,
  useLiveQuery,
  type InitialQueryBuilder,
} from "@tanstack/react-db";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as React from "react";

import { minuteClockAtom, stockPolicyAtom } from "./atoms";
import { useCatalogReplica } from "./provider";
import { catalogProductSearchResults, type CatalogProductSearchResult } from "./search";
import type { Inventory } from "./types";

const PRODUCT_IDS_PER_PREDICATE = 32;

const chunked = <Value>(values: ReadonlyArray<Value>, size: number) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );

export const useCatalogCategories = () => {
  const inventory = useCatalogReplica();
  const live = useLiveQuery(
    (query) =>
      query
        .from({ category: inventory.categories })
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

export const useCatalogProducts = (limit = 100) => {
  const inventory = useCatalogReplica();
  const live = useLiveQuery(
    (query) =>
      query
        .from({ product: inventory.products })
        .innerJoin({ category: inventory.categories }, ({ product, category }) =>
          eq(product.categoryId, category.id),
        )
        .orderBy(({ product }) => product.name, "asc")
        .limit(limit)
        .select(({ product, category }) => ({
          id: product.id,
          name: product.name,
          categoryId: product.categoryId,
          aisle: product.aisle,
          composition: product.composition,
          strength: product.strength,
          unitsPerPack: product.unitsPerPack,
          purchasePrice: product.purchasePrice,
          retailPrice: product.retailPrice,
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
              .where(({ batch }) => eq(batch.productId, product.id))
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
  const inventory = useCatalogReplica();
  const live = useLiveQuery(
    (query) =>
      query
        .from({ product: inventory.products })
        .innerJoin({ category: inventory.categories }, ({ product, category }) =>
          eq(product.categoryId, category.id),
        )
        .where(({ product }) => eq(product.id, productId))
        .select(({ product, category }) => ({
          id: product.id,
          name: product.name,
          categoryId: product.categoryId,
          aisle: product.aisle,
          composition: product.composition,
          strength: product.strength,
          unitsPerPack: product.unitsPerPack,
          purchasePrice: product.purchasePrice,
          retailPrice: product.retailPrice,
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
              .where(({ batch }) => eq(batch.productId, product.id))
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
    [inventory, productId],
  );
  const data: Product | undefined = live.data[0];
  return { ...live, data };
};

export const useCatalogStockMovements = (productId: string, limit = 50) => {
  const inventory = useCatalogReplica();
  const live = useLiveQuery(
    (query) =>
      query
        .from({ movement: inventory.stockMovements })
        .where(({ movement }) => eq(movement.productId, productId))
        .orderBy(({ movement }) => movement.createdAt, "desc")
        .limit(limit)
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

export const useInventoryInvoices = (limit = 50) => {
  const inventory = useCatalogReplica();
  const live = useLiveQuery(
    (query) =>
      query
        .from({ invoice: inventory.invoices })
        .orderBy(({ invoice }) => invoice.createdAt, "desc")
        .limit(limit)
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
              .where(({ item }) => eq(item.invoiceId, invoice.id))
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
  const inventory = useCatalogReplica();
  const live = useLiveQuery(
    (query) =>
      query
        .from({ invoice: inventory.invoices })
        .where(({ invoice }) => eq(invoice.id, invoiceId))
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
              .where(({ item }) => eq(item.invoiceId, invoice.id))
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
    [inventory, invoiceId],
  );
  const data: Invoice | undefined = live.data[0];
  return { ...live, data };
};

export const useCatalogSuggestions = (): ProductSuggestions => {
  const inventory = useCatalogReplica();
  const live = useLiveQuery(
    (query) =>
      query.from({ product: inventory.products }).select(({ product }) => ({
        name: product.name,
        aisle: product.aisle,
        composition: product.composition,
      })),
    [inventory],
  );
  const distinct = (values: ReadonlyArray<string | null>) =>
    [...new Set(values.flatMap((value) => (value?.trim() ? [value.trim()] : [])))].sort((a, b) =>
      a.localeCompare(b),
    );
  const rows = live.data;
  return {
    names: distinct(rows.map((product) => product.name)),
    aisles: distinct(rows.map((product) => product.aisle)),
    compositions: distinct(rows.map((product) => product.composition)),
  };
};

export const batchesForProducts = (
  builder: InitialQueryBuilder,
  inventory: Pick<Inventory, "batches">,
  productIds: ReadonlyArray<string>,
) => {
  const [first, second, ...rest] = chunked(productIds, PRODUCT_IDS_PER_PREDICATE);
  if (!first) return undefined;
  return builder
    .from({ batch: inventory.batches })
    .where(({ batch }) =>
      second
        ? or(
            inArray(batch.productId, first),
            inArray(batch.productId, second),
            ...rest.map((ids) => inArray(batch.productId, ids)),
          )
        : inArray(batch.productId, first),
    );
};

const useLatestSuccess = <A, E>(result: AsyncResult.AsyncResult<A, E>): Option.Option<A> => {
  const current = AsyncResult.value(result);
  const [latest, setLatest] = React.useState<Option.Option<A>>(current);
  if (Option.isSome(current) && (Option.isNone(latest) || latest.value !== current.value)) {
    setLatest(current);
  }
  return Option.isSome(current) ? current : latest;
};

const NO_PRODUCTS: ReadonlyArray<ProductRow> = [];

const NO_ROW_IDS: ReadonlySet<string> = new Set();

export const usePendingRowIds = (entity: SyncEntity): ReadonlySet<string> => {
  const inventory = useCatalogReplica();
  const result = useAtomValue(inventory.atoms.pendingRowIds(entity));
  return Option.getOrElse(useLatestSuccess(result), () => NO_ROW_IDS);
};

export const useCatalogProductSearch = (query: string, limit = 50) => {
  const inventory = useCatalogReplica();
  const policy = useAtomValue(stockPolicyAtom);
  const now = useAtomValue(minuteClockAtom);
  const searched = useAtomValue(inventory.atoms.productSearch(limit)(query));
  const latest = useLatestSuccess(searched);
  const matches = Option.getOrElse(latest, () => NO_PRODUCTS);
  const matchKey = matches.map((product) => product.id).join(" ");
  const batches = useLiveQuery(
    (builder) => batchesForProducts(builder, inventory, matchKey ? matchKey.split(" ") : []),
    [inventory, matchKey],
  );
  const data = React.useMemo<ReadonlyArray<CatalogProductSearchResult>>(
    () => catalogProductSearchResults(matches, batches.data ?? [], policy, now),
    [matches, batches.data, policy, now],
  );
  return {
    data,
    isLoading: Option.isNone(latest) || batches.isLoading,
    isError: AsyncResult.isFailure(searched) || batches.isError,
  };
};
