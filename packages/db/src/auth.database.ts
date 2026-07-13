import { CamelCasePlugin, Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

export const createAuthDatabase = (connectionString: string) =>
  new Kysely<Record<string, unknown>>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 5_000,
        max: 1,
      }),
    }),
    plugins: [new CamelCasePlugin()],
  });

export type AuthDatabase = ReturnType<typeof createAuthDatabase>;
