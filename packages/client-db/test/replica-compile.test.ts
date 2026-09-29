import { IR } from "@tanstack/db";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { lowerSqliteSubset } from "../src/replica/compile";
import { UnsupportedSubsetQuery } from "../src/replica/errors";
import { DEFAULT_COLLECTION_MAXIMUM_ROWS, MAX_IN_VALUES } from "../src/replica/sources";
import { analyzeInventorySubset, planInventoryRead } from "../src/replica/subset-ir";
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
  nulls: "first" as const,
  stringSort: "lexical" as const,
};

describe("lowerSqliteSubset", () => {
  it("compiles an indexed equality into parameterized SQL", () => {
    const plan = Effect.runSync(
      compileSqliteSubset(descriptor, {
        where: new IR.Func("eq", [new IR.PropRef(["id"]), new IR.Value("cat-1")]),
        limit: 20,
      }),
    );
    expect(plan.sql).toBe(
      `select "id", "name", "tracksPacks", "createdAt", "updatedAt", "organizationId", "createdByUserId", "updatedByUserId", "deviceId", "operationId", "rowVersion" from "categories" where "categories"."id" = ? limit ?`,
    );
    expect(plan.parameters).toEqual(["cat-1", 20]);
  });

  it.each<[string, InventoryCollectionDescriptor<CategoryRow>["source"], CompileSubsetInput]>([
    [
      "an operator that would require a scan",
      "categories",
      {
        where: new IR.Func("like", [new IR.PropRef(["name"]), new IR.Value("%scan%")]),
        limit: 20,
      },
    ],
    [
      "nested property references",
      "categories",
      {
        where: new IR.Func("eq", [new IR.PropRef(["name", "length", "value"]), new IR.Value(1)]),
        limit: 20,
      },
    ],
    [
      "unindexed ordering",
      "products",
      {
        orderBy: [{ expression: new IR.PropRef(["composition"]), compareOptions: compare }],
        limit: 20,
      },
    ],
    ["history without a limit", "invoices", {}],
    ["a catalog read without a limit", "products", {}],
    [
      "locale string ordering",
      "categories",
      {
        orderBy: [
          {
            expression: new IR.PropRef(["name"]),
            compareOptions: { ...compare, stringSort: "locale" },
          },
        ],
        limit: 20,
      },
    ],
    [
      "history bounded only by a range",
      "invoices",
      { where: new IR.Func("gt", [new IR.PropRef(["createdAt"]), new IR.Value(0)]) },
    ],
    [
      "an in list larger than the indexed bound",
      "categories",
      {
        where: new IR.Func("in", [
          new IR.PropRef(["id"]),
          new IR.Value(Array.from({ length: MAX_IN_VALUES + 1 }, (_, index) => `id-${index}`)),
        ]),
        limit: 20,
      },
    ],
  ])("fails on %s", (_name, source, options) => {
    expect(() => Effect.runSync(compileSqliteSubset({ ...descriptor, source }, options))).toThrow(
      UnsupportedSubsetQuery,
    );
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
    expect(plan.sql).toBe(
      `select "id", "invoiceNumber", "customerName", "total", "createdAt", "updatedAt", "organizationId", "createdByUserId", "updatedByUserId", "deviceId", "operationId", "rowVersion" from "invoices" where "invoices"."createdAt" < ? limit ?`,
    );
    expect(plan.parameters).toEqual([100, 25]);
  });

  it("drains unlimited requests instead of windowing them", () => {
    const invoices: InventoryCollectionDescriptor<CategoryRow> = {
      ...descriptor,
      source: "invoices",
    };
    expect(Effect.runSync(planInventoryRead(invoices, {}))).toEqual({ _tag: "drain" });
    expect(
      Effect.runSync(
        planInventoryRead(invoices, {
          where: new IR.Func("gt", [new IR.PropRef(["createdAt"]), new IR.Value(0)]),
        }),
      ),
    ).toEqual({
      _tag: "drain",
      where: { _tag: "compare", column: "createdAt", op: "gt", value: 0 },
    });
    expect(() => Effect.runSync(planInventoryRead(invoices, { offset: 5 }))).toThrow(
      UnsupportedSubsetQuery,
    );
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
    expect(() =>
      Effect.runSync(
        lowerSqliteSubset({
          source: "products",
          where: { _tag: "like", column: "retailPrice", pattern: "%1%" },
          orderBy: [],
          limit: 10,
          offset: 0,
        }),
      ),
    ).toThrow(UnsupportedSubsetQuery);
  });
});
