import { IR } from "@tanstack/db";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { planIndexedDbSubset } from "../src/replica/indexeddb-plan";
import { DEFAULT_COLLECTION_MAXIMUM_ROWS } from "../src/replica/sources";
import { analyzeInventorySubset } from "../src/replica/subset-ir";
import type { InventoryCollectionDescriptor } from "../src/replica/types";
import type { CategoryRow, InvoiceItemRow, InvoiceRow } from "../src/rows";

const categoryDescriptor: InventoryCollectionDescriptor<CategoryRow> = {
  id: "test:categories",
  source: "categories",
  syncMode: "on-demand",
  maximumRows: DEFAULT_COLLECTION_MAXIMUM_ROWS,
  getKey: (row) => row.id,
  decodeRows: () => Effect.succeed([]),
};

const invoiceDescriptor: InventoryCollectionDescriptor<InvoiceRow> = {
  id: "test:invoices",
  source: "invoices",
  syncMode: "on-demand",
  maximumRows: DEFAULT_COLLECTION_MAXIMUM_ROWS,
  getKey: (row) => row.id,
  decodeRows: () => Effect.succeed([]),
};

const invoiceItemDescriptor: InventoryCollectionDescriptor<InvoiceItemRow> = {
  id: "test:invoice-items",
  source: "invoiceItems",
  syncMode: "on-demand",
  maximumRows: DEFAULT_COLLECTION_MAXIMUM_ROWS,
  getKey: (row) => row.id,
  decodeRows: () => Effect.succeed([]),
};

describe("planIndexedDbSubset", () => {
  it("plans a catalog id lookup onto the primary key", () => {
    const plan = Effect.runSync(
      Effect.gen(function* () {
        const spec = yield* analyzeInventorySubset(categoryDescriptor, {
          where: new IR.Func("eq", [new IR.PropRef(["id"]), new IR.Value("cat-1")]),
          limit: 20,
        });
        return yield* planIndexedDbSubset(spec);
      }),
    );
    expect(plan.scan).toEqual({ _tag: "primaryEquals", id: "cat-1" });
    expect(plan.table).toBe("categories");
  });

  it("plans invoice items by invoiceId onto byInvoice", () => {
    const plan = Effect.runSync(
      Effect.gen(function* () {
        const spec = yield* analyzeInventorySubset(invoiceItemDescriptor, {
          where: new IR.Func("eq", [new IR.PropRef(["invoiceId"]), new IR.Value("inv-1")]),
          limit: 20,
        });
        return yield* planIndexedDbSubset(spec);
      }),
    );
    expect(plan.scan).toEqual({
      _tag: "indexEquals",
      index: "byInvoice",
      value: "inv-1",
    });
  });

  it("plans a bounded invoice list onto byCreatedAt", () => {
    const plan = Effect.runSync(
      Effect.gen(function* () {
        const spec = yield* analyzeInventorySubset(invoiceDescriptor, {
          orderBy: [
            {
              expression: new IR.PropRef(["createdAt"]),
              compareOptions: { direction: "desc", nulls: "last", stringSort: "locale" },
            },
          ],
          limit: 25,
        });
        return yield* planIndexedDbSubset(spec);
      }),
    );
    expect(plan.scan).toEqual({
      _tag: "indexPrefix",
      index: "byCreatedAt",
      reverse: true,
    });
    expect(plan.limit).toBe(25);
  });

  it("plans name-ordered product pages onto byNameKey, including searches", () => {
    const page = Effect.runSync(
      planIndexedDbSubset({
        source: "products",
        orderBy: [
          { column: "name", direction: "desc" },
          { column: "id", direction: "desc" },
        ],
        limit: 50,
        offset: 100,
      }),
    );
    expect(page.scan).toEqual({ _tag: "indexPrefix", index: "byNameKey", reverse: true });
    expect(page.residual).toBeUndefined();

    const search = Effect.runSync(
      planIndexedDbSubset({
        source: "products",
        where: {
          _tag: "or",
          predicates: [
            { _tag: "like", column: "name", pattern: "%pan%" },
            { _tag: "like", column: "composition", pattern: "%pan%" },
          ],
        },
        orderBy: [
          { column: "name", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
        limit: 50,
        offset: 0,
      }),
    );
    expect(search.scan).toEqual({ _tag: "indexPrefix", index: "byNameKey", reverse: false });
  });

  it("keeps an equality index ahead of the name order", () => {
    const plan = Effect.runSync(
      planIndexedDbSubset({
        source: "products",
        where: { _tag: "compare", column: "categoryId", op: "eq", value: "c-1" },
        orderBy: [{ column: "name", direction: "asc" }],
        limit: 50,
        offset: 0,
      }),
    );
    expect(plan.scan).toEqual({ _tag: "indexEquals", index: "byCategory", value: "c-1" });
  });
});
