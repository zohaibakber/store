import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as Schema from "effect/Schema";
import EmbeddedPostgres from "embedded-postgres";

const migrationsDir = fileURLToPath(
  new URL("../../../../packages/db/migrations/postgres/", import.meta.url),
);

const ListenAddress = Schema.Struct({
  port: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 65_535 })),
});

const listenPort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const decoded = Schema.decodeUnknownResult(ListenAddress)(server.address());
      if (decoded._tag === "Failure") {
        reject(new Error("Could not allocate a Postgres port."));
        return;
      }
      server.close(() => resolve(decoded.success.port));
    });
  });

export type AuthorityPostgres = {
  readonly connectionString: string;
  readonly close: () => Promise<void>;
};

type MigrationClient = {
  readonly query: (statement: string) => Promise<void>;
};

export type AuthorityPostgresOptions = {
  readonly seedBeforeMigration?: {
    readonly migration: string;
    readonly seed: (query: (statement: string) => Promise<void>) => Promise<void>;
  };
};

export const startAuthorityPostgres = async (
  options: AuthorityPostgresOptions = {},
): Promise<AuthorityPostgres> => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-inventory-authority-"));
  const port = await listenPort();
  const password = "postgres";
  const database = new EmbeddedPostgres({
    databaseDir: directory,
    port,
    user: "postgres",
    password,
    persistent: false,
    postgresFlags: ["-c", "wal_level=logical", "-c", "max_connections=20"],
    onLog: () => undefined,
  });
  await database.initialise();
  await database.start();
  await database.createDatabase("inventory");
  const connectionString = `postgres://postgres:${password}@127.0.0.1:${port}/inventory`;
  const client = database.getPgClient("inventory");
  await client.connect();
  try {
    await applyMigrations(
      {
        query: async (statement) => {
          await client.query(statement);
        },
      },
      options,
    );
  } finally {
    await client.end();
  }
  return {
    connectionString,
    close: async () => {
      await database.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
};

const applyMigrations = async (client: MigrationClient, options: AuthorityPostgresOptions) => {
  const entries = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const seedBefore = options.seedBeforeMigration;
  if (seedBefore !== undefined && !entries.includes(seedBefore.migration)) {
    throw new Error(`Unknown migration ${seedBefore.migration}.`);
  }
  for (const entry of entries) {
    if (seedBefore !== undefined && entry === seedBefore.migration) {
      await seedBefore.seed(client.query);
    }
    const sql = await readFile(path.join(migrationsDir, entry, "migration.sql"), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed.length === 0) continue;
      await client.query(trimmed);
    }
  }
};
