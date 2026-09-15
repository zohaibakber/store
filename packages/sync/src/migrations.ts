const STATEMENT_SEPARATOR = "--> statement-breakpoint";

const LEDGER_TABLE = "__store_sync_migrations";

const MIGRATION_KEY_PATTERN = /^[0-9a-z_]+$/u;

export type SqliteMigrationTarget = {
  readonly execute: (sql: string, parameters: ReadonlyArray<string>) => void;
  readonly appliedKeys: (sql: string) => ReadonlyArray<string>;
};

export const migrationStatements = (migration: string): ReadonlyArray<string> =>
  migration
    .split(STATEMENT_SEPARATOR)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

export const runMigrations = (
  migrations: Record<string, string>,
  target: SqliteMigrationTarget,
): void => {
  target.execute(`create table if not exists ${LEDGER_TABLE} (key text primary key not null)`, []);
  const applied = new Set(target.appliedKeys(`select key from ${LEDGER_TABLE}`));
  for (const key of Object.keys(migrations).sort()) {
    if (applied.has(key)) continue;
    if (!MIGRATION_KEY_PATTERN.test(key)) {
      throw new Error(`Sync migration key ${key} is not a safe identifier.`);
    }
    const migration = migrations[key];
    if (migration === undefined) continue;
    for (const statement of migrationStatements(migration)) target.execute(statement, []);
    target.execute(`insert into ${LEDGER_TABLE} (key) values (?)`, [key]);
  }
};
