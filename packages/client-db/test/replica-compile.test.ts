import { IR } from "@tanstack/db";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { lowerSqliteSubset } from "../src/replica/compile";
import { UnsupportedSubsetQuery } from "../src/replica/errors";
import { DEFAULT_COLLECTION_MAXIMUM_ROWS, MAX_IN_VALUES } from "../src/replica/sources";
import { analyzeInventorySubset } from "../src/replica/subset-ir";
import type { CompileSubsetInput, InventoryCollectionDescriptor } from "../src/replica/types";
import type { CategoryRow } from "../src/rows";

const descriptor: InventoryCollectionDescriptor<CategoryRow> = {
  id: "test:categories",
  source: "categories",
  syncMode: "on-demand",
  maximumRows: DEFAULT_COLLECTION_MAXIMUM_ROWS,
  getKey: (row) => row.id,
  decodeRows: () => Effect.succeed([]),
};

const compileSqliteSubset = (
  target: InventoryCollectionDescriptor<CategoryRow>,
  options: CompileSubsetInput,
) => analyzeInventorySubset(target, options).pipe(Effect.flatMap(lowerSqliteSubset));

const compare = {
  direction: "asc" as const,
  nulls: "last" as const,
  stringSort: "locale" as const,
};

describe("lowerSqliteSubset", () => {
  it("compiles an indexed equality into parameterized SQL", () => {
    const plan = Effect.runSync(
      compileSqliteSubset(descriptor, {
        where: new IR.Func("eq", [new IR.PropRef(["id"]), new IR.Value("cat-1")]),
        limit: 20,
      }),
    );
    expect(plan.sql).toBe(`SELECT * FROM "categories" WHERE "id" = ? LIMIT ?`);
    expect(plan.parameters).toEqual(["cat-1", 20]);
  });

  it("fails on an operator that would require a scan", () => {
    expect(() =>
      Effect.runSync(
        compileSqliteSubset(descriptor, {
          where: new IR.Func("like", [new IR.PropRef(["name"]), new IR.Value("%scan%")]),
          limit: 20,
        }),
      ),
    ).toThrow(UnsupportedSubsetQuery);
  });

  it("fails on nested property references", () => {
    expect(() =>
      Effect.runSync(
        compileSqliteSubset(descriptor, {
          where: new IR.Func("eq", [new IR.PropRef(["name", "length", "value"]), new IR.Value(1)]),
          limit: 20,
        }),
      ),
    ).toThrow(UnsupportedSubsetQuery);
  });

  it("fails on unindexed ordering", () => {
    const products: InventoryCollectionDescriptor<CategoryRow> = {
      ...descriptor,
      source: "products",
    };
    expect(() =>
      Effect.runSync(
        compileSqliteSubset(products, {
          orderBy: [{ expression: new IR.PropRef(["composition"]), compareOptions: compare }],
          limit: 20,
        }),
      ),
    ).toThrow(UnsupportedSubsetQuery);
  });

  it("fails when history has no bounded limit", () => {
    const invoices: InventoryCollectionDescriptor<CategoryRow> = {
      ...descriptor,
      source: "invoices",
    };
    expect(() => Effect.runSync(compileSqliteSubset(invoices, {}))).toThrow(UnsupportedSubsetQuery);
    expect(() =>
      Effect.runSync(
        compileSqliteSubset(invoices, {
          where: new IR.Func("gt", [new IR.PropRef(["createdAt"]), new IR.Value(0)]),
        }),
      ),
    ).toThrow(UnsupportedSubsetQuery);
  });

  it("pages by the cursor when a window also carries an offset", () => {
    const invoices: InventoryCollectionDescriptor<CategoryRow> = {
      ...descriptor,
      source: "invoices",
    };
    const plan = Effect.runSync(
      compileSqliteSubset(invoices, {
        cursor: {
          whereFrom: new IR.Func("lt", [new IR.PropRef(["createdAt"]), new IR.Value(100)]),
          whereCurrent: new IR.Func("eq", [new IR.PropRef(["createdAt"]), new IR.Value(100)]),
        },
        offset: 50,
        limit: 25,
      }),
    );
    expect(plan.sql).toBe(`SELECT * FROM "invoices" WHERE "createdAt" < ? LIMIT ?`);
    expect(plan.parameters).toEqual([100, 25]);
  });

  it("reads history without a limit when a key predicate bounds it", () => {
    const invoiceItems: InventoryCollectionDescriptor<CategoryRow> = {
      ...descriptor,
      source: "invoiceItems",
    };
    const joined = Effect.runSync(
      compileSqliteSubset(invoiceItems, {
        where: new IR.Func("in", [new IR.PropRef(["invoiceId"]), new IR.Value(["inv-1", "inv-2"])]),
      }),
    );
    expect(joined.sql).toBe(`SELECT * FROM "invoice_items" WHERE "invoiceId" IN (?, ?) LIMIT ?`);
    expect(joined.parameters).toEqual(["inv-1", "inv-2", DEFAULT_COLLECTION_MAXIMUM_ROWS]);
    const single = Effect.runSync(
      compileSqliteSubset(invoiceItems, {
        where: new IR.Func("eq", [new IR.PropRef(["invoiceId"]), new IR.Value("inv-1")]),
      }),
    );
    expect(single.parameters).toEqual(["inv-1", DEFAULT_COLLECTION_MAXIMUM_ROWS]);
    const invoices: InventoryCollectionDescriptor<CategoryRow> = {
      ...descriptor,
      source: "invoices",
    };
    const ties = Effect.runSync(
      compileSqliteSubset(invoices, {
        where: new IR.Func("eq", [new IR.PropRef(["createdAt"]), new IR.Value(1_790_000_000_000)]),
      }),
    );
    expect(ties.parameters).toEqual([1_790_000_000_000, DEFAULT_COLLECTION_MAXIMUM_ROWS]);
  });

  it("fails when in is larger than the indexed bound", () => {
    const values = Array.from({ length: MAX_IN_VALUES + 1 }, (_, index) => `id-${index}`);
    expect(() =>
      Effect.runSync(
        compileSqliteSubset(descriptor, {
          where: new IR.Func("in", [new IR.PropRef(["id"]), new IR.Value(values)]),
          limit: 20,
        }),
      ),
    ).toThrow(UnsupportedSubsetQuery);
  });

  it("rejects a received spec whose column is outside the source allowlist", () => {
    expect(() =>
      Effect.runSync(
        lowerSqliteSubset({
          source: "categories",
          where: { _tag: "compare", column: "productId", op: "eq", value: "p-1" },
          orderBy: [],
          limit: 10,
          offset: 0,
        }),
      ),
    ).toThrow(UnsupportedSubsetQuery);
    expect(() =>
      Effect.runSync(
        lowerSqliteSubset({
          source: "products",
          orderBy: [{ column: "composition", direction: "asc" }],
          limit: 10,
          offset: 0,
        }),
      ),
    ).toThrow(UnsupportedSubsetQuery);
  });
});
