import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { collectGraph, matchingSpecifiers, packageRoot } from "./lib/import-graph";

const NATIVE = [
  "better-sqlite3",
  "@effect/sql-sqlite-",
  "@op-engineering/op-sqlite",
  "expo-sqlite",
  "drizzle-orm/better-sqlite3",
  "drizzle-orm/node-sqlite",
  "drizzle-orm/effect-sqlite-node",
  "drizzle-orm/bun-sqlite",
  "drizzle-orm/op-sqlite",
  "drizzle-orm/expo-sqlite",
] as const;

const ENTRYPOINTS = [
  ["@store/sync", "src/index.ts"],
  ["@store/sync/browser", "src/browser.ts"],
  ["@store/sync/sql-client", "src/sql-client.ts"],
] as const;

const graphOf = (entry: string) => collectGraph(resolve(packageRoot, entry), ["drizzle-orm"]);

describe("native-free entrypoints", () => {
  it.each(ENTRYPOINTS)("%s reaches no native SQLite driver or node built-in", (_name, entry) => {
    const graph = graphOf(entry);
    expect(graph.files.size).toBeGreaterThan(5);
    expect(matchingSpecifiers(graph.bare, NATIVE)).toStrictEqual([]);
  });

  it("follows the Drizzle internals the generic session is built from", () => {
    const graph = graphOf("src/sql-client.ts");
    const drizzleFiles = [...graph.files].filter((file) => file.includes("/drizzle-orm/"));
    expect(drizzleFiles.some((file) => file.endsWith("sqlite-core/effect/session.js"))).toBe(true);
    expect(drizzleFiles.length).toBeGreaterThan(20);
  });

  it("still detects the native driver behind the Node entrypoint", () => {
    const graph = graphOf("src/sqlite.ts");
    expect(matchingSpecifiers(graph.bare, NATIVE)).toContain(
      "@effect/sql-sqlite-node/SqliteClient",
    );
  });
});
