import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { openReplicaStore } from "../src/replica/storage";

const ENTITY_TABLES = [
  "categories",
  "products",
  "batches",
  "invoices",
  "invoice_items",
  "stock_movements",
] as const;

const ColumnRow = Schema.Struct({ name: Schema.String });
const decodeColumns = Schema.decodeUnknownSync(Schema.Array(ColumnRow));
const decodeIndexDefinition = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ sql: Schema.String })),
);

describe("replica schema after the hard-delete migration", () => {
  it("keeps no deletedAt column on any entity table", async () => {
    const columnsByTable = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openReplicaStore();
          const collected: Array<ReadonlyArray<string>> = [];
          for (const table of ENTITY_TABLES) {
            const rows = yield* store.sql.unsafe(`PRAGMA table_info(${table})`);
            collected.push(decodeColumns(rows).map((column) => column.name));
          }
          return collected;
        }),
      ),
    );
    for (const columns of columnsByTable) {
      expect(columns).not.toContain("deletedAt");
    }
  });

  it("enforces no foreign keys that a parent delete would violate", async () => {
    const lists = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openReplicaStore();
          const collected: Array<ReadonlyArray<unknown>> = [];
          for (const table of ENTITY_TABLES) {
            collected.push(yield* store.sql.unsafe(`PRAGMA foreign_key_list(${table})`));
          }
          return collected;
        }),
      ),
    );
    for (const list of lists) {
      expect(list).toStrictEqual([]);
    }
  });

  it("keeps the category name unique without a partial predicate", async () => {
    const definition = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openReplicaStore();
          const rows = yield* store.sql.unsafe(
            `select sql from sqlite_master where name = 'categories_organization_id_name_uidx'`,
          );
          return decodeIndexDefinition(rows)[0]?.sql;
        }),
      ),
    );
    expect(definition).toBeDefined();
    expect(definition).not.toContain("where");
  });
});
