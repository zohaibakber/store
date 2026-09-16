import { IR } from "@tanstack/db";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { compileSqliteSubset } from "../src/replica/compile";
import { UnsupportedSubsetQuery } from "../src/replica/errors";
import { DEFAULT_COLLECTION_MAXIMUM_ROWS } from "../src/replica/sources";
import type { InventoryCollectionDescriptor } from "../src/replica/types";
import type { CategoryRow } from "../src/rows";

const descriptor: InventoryCollectionDescriptor<CategoryRow> = {
  id: "test:categories",
  source: "categories",
  syncMode: "on-demand",
  maximumRows: DEFAULT_COLLECTION_MAXIMUM_ROWS,
  getKey: (row) => row.id,
  decodeRows: () => Effect.succeed([]),
};

const compare = {
  direction: "asc" as const,
  nulls: "last" as const,
  stringSort: "locale" as const,
};

describe("compileSqliteSubset", () => {
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
          orderBy: [{ expression: new IR.PropRef(["name"]), compareOptions: compare }],
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
  });

  it("fails when in is larger than the indexed bound", () => {
    const values = Array.from({ length: 33 }, (_, index) => `id-${index}`);
    expect(() =>
      Effect.runSync(
        compileSqliteSubset(descriptor, {
          where: new IR.Func("in", [new IR.PropRef(["id"]), new IR.Value(values)]),
          limit: 20,
        }),
      ),
    ).toThrow(UnsupportedSubsetQuery);
  });
});
