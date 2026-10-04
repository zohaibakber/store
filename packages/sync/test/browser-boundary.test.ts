import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { collectGraph, matchingSpecifiers, packageRoot } from "./lib/import-graph";

const FORBIDDEN = [
  "better-sqlite3",
  "@effect/sql-sqlite-node",
  "drizzle-orm/better-sqlite3",
  "drizzle-orm/node-sqlite",
  "drizzle-orm/effect-sqlite-node",
  "drizzle-orm/bun-sqlite",
] as const;

const nativeSpecifiers = (bare: ReadonlySet<string>) => matchingSpecifiers(bare, FORBIDDEN);

describe("shared entrypoint boundary", () => {
  it("reaches no native SQLite driver or node built-in from the shared entrypoint", () => {
    const graph = collectGraph(resolve(packageRoot, "src/index.ts"));
    expect(graph.files.size).toBeGreaterThan(5);
    expect(nativeSpecifiers(graph.bare)).toStrictEqual([]);
  });

  it("still detects the native driver when it is reachable", () => {
    const graph = collectGraph(resolve(packageRoot, "src/sqlite.ts"));
    expect(nativeSpecifiers(graph.bare)).toContain("@effect/sql-sqlite-node/SqliteClient");
  });
});
