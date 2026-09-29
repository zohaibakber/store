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

export const startAuthorityPostgres = async (): Promise<AuthorityPostgres> => {
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
  const createDatabase = async (name: string) => {
    await database.createDatabase(name);
    const client = database.getPgClient(name);
    await client.connect();
    try {
      for (const statement of await migrationStatements()) await client.query(statement);
    } finally {
      await client.end();
    }
    return `postgres://postgres:${password}@127.0.0.1:${port}/${name}`;
  };
  const connectionString = await createDatabase("inventory");
  return {
    connectionString,
    close: async () => {
      await database.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
};

const migrationStatements = async () => {
  const entries = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const statements: Array<string> = [];
  for (const entry of entries) {
    const sql = await readFile(path.join(migrationsDir, entry, "migration.sql"), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) statements.push(trimmed);
    }
  }
  return statements;
};
