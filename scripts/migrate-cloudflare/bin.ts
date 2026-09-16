import type Database from "better-sqlite3";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import { liveCheckpointLayer } from "./src/checkpoint.ts";
import { sqliteDirectoryLayer } from "./src/directory.ts";
import { ConfigurationError } from "./src/errors.ts";
import { journalLayerFromSqlite } from "./src/export-store.ts";
import { liveIdsLayer } from "./src/ids.ts";
import {
  DEFAULT_CHUNK_SIZE,
  MigrationRequest as MigrationRequestSchema,
  OrganizationSelection,
} from "./src/model.ts";
import { postgresSourceLayer } from "./src/postgres-source.ts";
import { openSqlite } from "./src/sqlite.ts";
import { sqliteTargetLayer } from "./src/target.ts";
import { runMigration } from "./src/workflow.ts";

const CliEnv = Schema.Struct({
  journalPath: Schema.String.check(Schema.isMinLength(1)),
  targetPath: Schema.String.check(Schema.isMinLength(1)),
  directoryPath: Schema.String.check(Schema.isMinLength(1)),
  connectionString: Schema.String.check(Schema.isMinLength(1)),
  sourceIdentity: Schema.String.check(Schema.isMinLength(1)),
  organizations: Schema.String.check(Schema.isMinLength(1)),
  chunkSize: Schema.String,
});

const parseOrganizations = Schema.decodeUnknownEffect(Schema.NonEmptyArray(OrganizationSelection));

const sqliteFile = (path: string): Effect.Effect<Database.Database, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => openSqlite(path)),
    (database) =>
      Effect.sync(() => {
        database.close();
      }),
  );

const parseRequest = Effect.fn("Migrate.Cli.parseRequest")(function* () {
  const env = yield* Schema.decodeUnknownEffect(CliEnv)({
    journalPath: process.env.MIGRATE_JOURNAL_PATH,
    targetPath: process.env.MIGRATE_TARGET_PATH,
    directoryPath: process.env.MIGRATE_DIRECTORY_PATH,
    connectionString: process.env.DATABASE_URL,
    sourceIdentity: process.env.MIGRATE_SOURCE_IDENTITY,
    organizations: process.env.MIGRATE_ORGANIZATIONS,
    chunkSize: process.env.MIGRATE_CHUNK_SIZE ?? String(DEFAULT_CHUNK_SIZE),
  }).pipe(
    Effect.mapError(
      () =>
        new ConfigurationError({
          message:
            "Set MIGRATE_JOURNAL_PATH, MIGRATE_TARGET_PATH, MIGRATE_DIRECTORY_PATH, DATABASE_URL, MIGRATE_SOURCE_IDENTITY, and MIGRATE_ORGANIZATIONS.",
        }),
    ),
  );
  const selections = yield* parseOrganizations(
    env.organizations.split(",").map((part) => {
      const [organizationId, objectName] = part.split(":");
      return { organizationId, objectName };
    }),
  ).pipe(
    Effect.mapError(
      () =>
        new ConfigurationError({
          message: "MIGRATE_ORGANIZATIONS must be a non-empty orgId:inventory-object list.",
        }),
    ),
  );
  const chunkSize = Number(env.chunkSize);
  const request = yield* Schema.decodeUnknownEffect(MigrationRequestSchema)({
    sourceIdentity: env.sourceIdentity,
    organizations: selections,
    chunkSize,
  }).pipe(
    Effect.mapError(
      () =>
        new ConfigurationError({
          message: "Migration request fields failed schema checks.",
        }),
    ),
  );
  return { env, request };
});

const program = Effect.scoped(
  Effect.gen(function* () {
    const parsed = yield* parseRequest();
    const journal = yield* sqliteFile(parsed.env.journalPath);
    const target = yield* sqliteFile(parsed.env.targetPath);
    const directory = yield* sqliteFile(parsed.env.directoryPath);
    const layer = Layer.mergeAll(
      journalLayerFromSqlite(journal),
      sqliteTargetLayer(target),
      sqliteDirectoryLayer(directory),
      liveIdsLayer,
      liveCheckpointLayer,
      postgresSourceLayer({ connectionString: parsed.env.connectionString }),
    );
    return yield* runMigration(parsed.request).pipe(Effect.provide(layer));
  }),
);

await Effect.runPromise(
  program.pipe(
    Effect.match({
      onFailure: (error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
        return error;
      },
      onSuccess: (result) => {
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return result;
      },
    }),
  ),
);
