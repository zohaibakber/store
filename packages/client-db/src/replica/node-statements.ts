import type { DatabaseSync, StatementSync } from "node:sqlite";

export const SQLITE_BUSY_TIMEOUT_MILLIS = 5_000;

export const preparedStatements = (db: DatabaseSync, capacity: number) => {
  const statements = new Map<string, StatementSync>();
  return {
    prepare: (sql: string) => {
      const cached = statements.get(sql);
      if (cached !== undefined) return cached;
      if (statements.size >= capacity) statements.clear();
      const created = db.prepare(sql);
      statements.set(sql, created);
      return created;
    },
    clear: () => statements.clear(),
  };
};
