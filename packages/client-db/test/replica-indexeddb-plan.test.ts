import { IR } from "@tanstack/db";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { analyzeInventorySubset } from "../src/replica/compile";
import { planIndexedDbSubset } from "../src/replica/indexeddb-plan";
import { DEFAULT_COLLECTION_MAXIMUM_ROWS } from "../src/replica/sources";
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
});
