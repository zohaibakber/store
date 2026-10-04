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
  ["@store/sync/sql-client", "src/sql-client.ts"],
] as const;

const graphOf = (entry: string) => collectGraph(resolve(packageRoot, entry), ["drizzle-orm"]);

describe("native-free entrypoints", () => {
  it.each(ENTRYPOINTS)("%s reaches no native SQLite driver or node built-in", (_name, entry) => {
    const graph = graphOf(entry);
    expect(graph.files.size).toBeGreaterThan(5);
    expect(matchingSpecifiers(graph.bare, NATIVE)).toStrictEqual([]);
  });
});
