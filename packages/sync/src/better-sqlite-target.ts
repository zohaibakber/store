import type Database from "better-sqlite3";
import * as Schema from "effect/Schema";

import type { SqliteMigrationTarget } from "./migrations";

const decodeKeys = Schema.decodeUnknownSync(Schema.Array(Schema.String));

export const betterSqliteMigrationTarget = (sqlite: Database.Database): SqliteMigrationTarget => ({
  execute: (sql, parameters) => {
    sqlite.prepare(sql).run(...parameters);
  },
  appliedKeys: (sql) => decodeKeys(sqlite.prepare(sql).pluck().all()),
});
