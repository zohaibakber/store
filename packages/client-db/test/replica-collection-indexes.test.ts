import { coalesce, createCollection, createLiveQueryCollection, eq, toArray } from "@tanstack/db";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sqliteCollectionOptions } from "../src/replica/collection";
import {
  decodeBatchSqliteRows,
  decodeCategorySqliteRows,
  decodeInvoiceItemSqliteRows,
  decodeInvoiceSqliteRows,
  decodeProductSqliteRows,
} from "../src/replica/decode";
import { openNodeReplicaSqlite } from "../src/replica/node-sqlite";
import type { BatchRow, CategoryRow, InvoiceItemRow, InvoiceRow, ProductRow } from "../src/rows";

const identity = { organizationId: "org-1", userId: "user-1", replicaId: "replica-1" };

type NodeReplica = Awaited<ReturnType<typeof openNodeReplicaSqlite>>;

const insertInvoice = (number: number) =>
  Effect.fn("test.insertInvoice")(function* (
    handle: Parameters<Parameters<NodeReplica["withWrite"]>[0]>[0],
  ) {
    yield* handle.sql.unsafe(
      `insert into invoices (
        id, invoiceNumber, customerName, total, createdAt, updatedAt,
        organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion
      ) values (?, ?, null, 100, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        `inv-${number}`,
        number,
        number,
        number,
        identity.organizationId,
        identity.userId,
        identity.userId,
        identity.replicaId,
        `op-${number}`,
      ],
    );
  });

const insertProduct = (number: number) =>
  Effect.fn("test.insertProduct")(function* (
    handle: Parameters<Parameters<NodeReplica["withWrite"]>[0]>[0],
  ) {
    yield* handle.sql.unsafe(
      `insert into products (
        id, name, categoryId, createdAt, updatedAt,
        organizationId, createdByUserId, updatedByUserId, deviceId, operationId
      ) values (?, ?, 'general', 1, 1, ?, ?, ?, ?, ?)`,
      [
        `prod-${number}`,
        `Product ${number}`,
        identity.organizationId,
        identity.userId,
        identity.userId,
        identity.replicaId,
        `op-prod-${number}`,
      ],
    );
  });

const indexWarnings = (warn: {
  readonly mock: { readonly calls: ReadonlyArray<ReadonlyArray<unknown>> };
}) => warn.mock.calls.filter(([message]) => String(message).includes("requires an index"));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("replica collection indexes", () => {
  it("serves ordered windows and included children from indexes after garbage collection", async () => {
    const warn = vi.spyOn(console, "warn");
    const replica = await openNodeReplicaSqlite(identity);
    for (const number of [1, 2, 3, 4]) {
      await replica.withWrite(insertInvoice(number), ["invoice"], [`inv-${number}`]);
    }
    const dependencies = { executor: replica, changeFeed: replica };
    const invoices = createCollection(
      sqliteCollectionOptions<InvoiceRow>(
        {
          id: "test:invoices",
          source: "invoices",
          syncMode: "on-demand",
          maximumRows: 10,
          getKey: (row) => row.id,
          decodeRows: decodeInvoiceSqliteRows,
        },
        dependencies,
      ),
    );
    const invoiceItems = createCollection(
      sqliteCollectionOptions<InvoiceItemRow>(
        {
          id: "test:invoice-items",
          source: "invoiceItems",
          syncMode: "on-demand",
          maximumRows: 10,
          getKey: (row) => row.id,
          decodeRows: decodeInvoiceItemSqliteRows,
        },
        dependencies,
      ),
    );
    const recentInvoices = () =>
      createLiveQueryCollection((query) =>
        query
          .from({ invoice: invoices })
          .orderBy(({ invoice }) => invoice.createdAt, "desc")
          .limit(2)
          .select(({ invoice }) => ({
            number: invoice.invoiceNumber,
            items: toArray(
              query
                .from({ item: invoiceItems })
                .where(({ item }) => eq(item.invoiceId, invoice.id))
                .select(({ item }) => ({ id: item.id })),
            ),
          })),
      );

    const first = recentInvoices();
    await first.preload();
    expect(first.toArray.map((row) => row.number)).toEqual([4, 3]);
    await first.cleanup();
    await invoices.cleanup();
    await invoiceItems.cleanup();

    const second = recentInvoices();
    await second.preload();
    expect(second.toArray.map((row) => row.number)).toEqual([4, 3]);
    expect(indexWarnings(warn)).toEqual([]);
    await second.cleanup();
    replica.close();
  });

  it("serves the catalog join, ordered window, and batch includes from indexes", async () => {
    const warn = vi.spyOn(console, "warn");
    const replica = await openNodeReplicaSqlite(identity);
    for (const number of [1, 2, 3]) {
      await replica.withWrite(insertProduct(number), ["product"], [`prod-${number}`]);
    }
    const dependencies = { executor: replica, changeFeed: replica };
    const categories = createCollection(
      sqliteCollectionOptions<CategoryRow>(
        {
          id: "test:categories",
          source: "categories",
          syncMode: "eager",
          maximumRows: 10,
          getKey: (row) => row.id,
          decodeRows: decodeCategorySqliteRows,
        },
        dependencies,
      ),
    );
    const products = createCollection(
      sqliteCollectionOptions<ProductRow>(
        {
          id: "test:products",
          source: "products",
          syncMode: "on-demand",
          maximumRows: 10,
          getKey: (row) => row.id,
          decodeRows: decodeProductSqliteRows,
        },
        dependencies,
      ),
    );
    const batches = createCollection(
      sqliteCollectionOptions<BatchRow>(
        {
          id: "test:batches",
          source: "batches",
          syncMode: "on-demand",
          maximumRows: 10,
          getKey: (row) => row.id,
          decodeRows: decodeBatchSqliteRows,
        },
        dependencies,
      ),
    );
    const catalog = createLiveQueryCollection((query) =>
      query
        .from({ product: products })
        .leftJoin({ category: categories }, ({ product, category }) =>
          eq(product.categoryId, category.id),
        )
        .orderBy(({ product }) => product.name, "asc")
        .limit(2)
        .select(({ product, category }) => ({
          name: product.name,
          category: coalesce(category.name, "Uncategorized"),
          batches: toArray(
            query
              .from({ batch: batches })
              .where(({ batch }) => eq(batch.productId, product.id))
              .select(({ batch }) => ({ id: batch.id })),
          ),
        })),
    );
    await catalog.preload();
    expect(catalog.toArray.map((row) => row.name)).toEqual(["Product 1", "Product 2"]);
    expect(indexWarnings(warn)).toEqual([]);
    await catalog.cleanup();
    replica.close();
  });
});
