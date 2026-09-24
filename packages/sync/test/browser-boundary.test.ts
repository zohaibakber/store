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

describe("browser entrypoint boundary", () => {
  it("reaches no native SQLite driver or node built-in from browser.ts", () => {
    const graph = collectGraph(resolve(packageRoot, "src/browser.ts"));
    expect(graph.files.size).toBeGreaterThan(5);
    expect(nativeSpecifiers(graph.bare)).toStrictEqual([]);
  });

  it("reaches no native SQLite driver or node built-in from the IndexedDB entrypoint", () => {
    const graph = collectGraph(resolve(packageRoot, "src/replica/indexeddb/store.ts"));
    expect(graph.files.size).toBeGreaterThan(3);
    expect(nativeSpecifiers(graph.bare)).toStrictEqual([]);
  });

  it("still detects the native driver when it is reachable", () => {
    const graph = collectGraph(resolve(packageRoot, "src/sqlite.ts"));
    expect(nativeSpecifiers(graph.bare)).toContain("@effect/sql-sqlite-node/SqliteClient");
  });
});
