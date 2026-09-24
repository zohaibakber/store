import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { liveCheckpointLayer } from "./src/checkpoint.ts";
import { sqliteDirectoryLayer } from "./src/directory.ts";
import { ConfigurationError } from "./src/errors.ts";
import { journalLayerFromSqlite } from "./src/export-store.ts";
import { liveIdsLayer } from "./src/ids.ts";
import { DEFAULT_CHUNK_SIZE, MigrationRequest, OrganizationSelection } from "./src/model.ts";
import { postgresSourceLayer } from "./src/postgres-source.ts";
import { openSqlite } from "./src/sqlite.ts";
import { sqliteTargetLayer } from "./src/target.ts";
import { runMigration } from "./src/workflow.ts";

const text = (flag: string, variable: string) =>
  Flag.String(flag).pipe(
    Flag.withFallbackConfig(Config.NonEmptyString(variable)),
    Flag.withDescription(`Falls back to ${variable}.`),
  );

const parseOrganizations = Schema.decodeUnknownEffect(Schema.NonEmptyArray(OrganizationSelection));
const decodeRequest = Schema.decodeUnknownEffect(MigrationRequest);

const selectionsFrom = (organizations: string) =>
  parseOrganizations(
    organizations.split(",").map((part) => {
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

const migrate = Command.make(
  "migrate-cloudflare",
  {
    journalPath: text("journal", "MIGRATE_JOURNAL_PATH"),
    targetPath: text("target", "MIGRATE_TARGET_PATH"),
    directoryPath: text("directory", "MIGRATE_DIRECTORY_PATH"),
    connectionString: Flag.Redacted("database-url").pipe(
      Flag.withFallbackConfig(Config.Redacted("DATABASE_URL")),
      Flag.withDescription("Falls back to DATABASE_URL."),
    ),
    sourceIdentity: text("source-identity", "MIGRATE_SOURCE_IDENTITY"),
    organizations: text("organizations", "MIGRATE_ORGANIZATIONS"),
    chunkSize: Flag.Int("chunk-size").pipe(
      Flag.withFallbackConfig(
        Config.Int("MIGRATE_CHUNK_SIZE").pipe(Config.withDefault(DEFAULT_CHUNK_SIZE)),
      ),
      Flag.withDescription(`Falls back to MIGRATE_CHUNK_SIZE, then ${DEFAULT_CHUNK_SIZE}.`),
    ),
  },
  (input) =>
    Effect.gen(function* () {
      const request = yield* decodeRequest({
        sourceIdentity: input.sourceIdentity,
        organizations: yield* selectionsFrom(input.organizations),
        chunkSize: input.chunkSize,
      }).pipe(
        Effect.mapError(
          () =>
            new ConfigurationError({ message: "Migration request fields failed schema checks." }),
        ),
      );
      const layer = Layer.mergeAll(
        journalLayerFromSqlite(yield* openSqlite(input.journalPath)),
        sqliteTargetLayer(yield* openSqlite(input.targetPath)),
        sqliteDirectoryLayer(yield* openSqlite(input.directoryPath)),
        liveIdsLayer,
        liveCheckpointLayer,
        postgresSourceLayer({ connectionString: Redacted.value(input.connectionString) }),
      );
      const result = yield* runMigration(request).pipe(Effect.provide(layer));
      yield* Console.log(JSON.stringify(result));
    }).pipe(
      Effect.scoped,
      Effect.tapError((error) => Console.error(error.message)),
    ),
);

Command.run(migrate, { version: "0.0.0" }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
