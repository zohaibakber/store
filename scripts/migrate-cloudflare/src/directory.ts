import type * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import {
  InventoryImportId,
  InventoryObjectName,
  InventoryReleaseId,
  OrganizationId,
} from "@store/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { PersistenceError, PublicationFailed } from "./errors.ts";
import {
  type ActiveReleasePointer,
  ActiveReleasePointer as ActiveReleasePointerSchema,
} from "./model.ts";
import { migrateDirectory, persistingAs } from "./sqlite.ts";

export const ReleaseEntry = Schema.Struct({
  organizationId: OrganizationId,
  objectName: InventoryObjectName,
  importId: InventoryImportId,
  status: Schema.Literals(["importing", "ready"]),
});
export interface ReleaseEntry extends Schema.Schema.Type<typeof ReleaseEntry> {}

export interface DatasetReleaseDirectoryApi {
  readonly ensureOrganization: (
    organizationId: OrganizationId,
  ) => Effect.Effect<void, PersistenceError>;
  readonly stageRelease: (
    releaseId: InventoryReleaseId,
    entries: ReadonlyArray<ReleaseEntry>,
  ) => Effect.Effect<void, PersistenceError | PublicationFailed>;
  readonly activateRelease: (
    releaseId: InventoryReleaseId,
  ) => Effect.Effect<ActiveReleasePointer, PersistenceError | PublicationFailed>;
  readonly readActiveRelease: () => Effect.Effect<
    Option.Option<ActiveReleasePointer>,
    PersistenceError
  >;
  readonly readReleaseStatus: (
    releaseId: InventoryReleaseId,
  ) => Effect.Effect<Option.Option<string>, PersistenceError>;
}

export interface DatasetReleaseDirectoryTestApi extends DatasetReleaseDirectoryApi {
  readonly loseNextActivation: () => Effect.Effect<void>;
}

export class DatasetReleaseDirectory extends Context.Service<
  DatasetReleaseDirectory,
  DatasetReleaseDirectoryApi
>()("@store/migrate/DatasetReleaseDirectory") {}

export class DatasetReleaseDirectoryTest extends Context.Service<
  DatasetReleaseDirectoryTest,
  DatasetReleaseDirectoryTestApi
>()("@store/migrate/DatasetReleaseDirectory/Test") {}

const persistenceFail = (operation: string, cause: unknown): PersistenceError =>
  new PersistenceError({
    operation,
    message: `Dataset directory ${operation} failed.`,
    cause,
  });

const persisting = (operation: string) =>
  persistingAs((cause) => persistenceFail(operation, cause));

const unixSeconds = (millis: number): number => Math.floor(millis / 1000);

const ReleaseRow = Schema.Struct({ id: Schema.String, status: Schema.String });

const publicationFailed = (message: string) =>
  new PublicationFailed({ incompleteStep: "publishDataset", message });

const makeDirectory = (
  sql: SqliteClient.SqliteClient,
  lostActivation: Ref.Ref<boolean>,
): DatasetReleaseDirectoryTestApi => {
  const selectOrganization = SqlSchema.findOneOption({
    Request: OrganizationId,
    Result: Schema.Struct({ id: Schema.String }),
    execute: (id) => sql`select id from auth_organization where id = ${id}`,
  });
  const selectRelease = SqlSchema.findOneOption({
    Request: InventoryReleaseId,
    Result: ReleaseRow,
    execute: (id) => sql`select id, status from inventory_dataset_release where id = ${id}`,
  });
  const selectActive = SqlSchema.findOneOption({
    Request: Schema.Void,
    Result: ActiveReleasePointerSchema,
    execute: () =>
      sql`select releaseId, activatedAt as activatedAtSeconds from inventory_active_release where id = 1`,
  });
  return {
    ensureOrganization: Effect.fn("Migrate.Directory.ensureOrganization")(function* (
      organizationId: OrganizationId,
    ) {
      const now = unixSeconds(yield* Clock.currentTimeMillis);
      const existing = yield* selectOrganization(organizationId);
      if (Option.isSome(existing)) return;
      yield* sql`insert into auth_organization (id, name, slug, createdAt, updatedAt) values (${organizationId}, ${organizationId}, ${organizationId}, ${now}, ${now})`;
    }, persisting("ensureOrganization")),
    stageRelease: Effect.fn("Migrate.Directory.stageRelease")(function* (
      releaseId: InventoryReleaseId,
      entries: ReadonlyArray<ReleaseEntry>,
    ) {
      if (entries.length === 0) {
        return yield* publicationFailed(
          "A dataset release requires at least one organization entry.",
        );
      }
      const now = unixSeconds(yield* Clock.currentTimeMillis);
      yield* Effect.gen(function* () {
        const existing = yield* selectRelease(releaseId);
        if (Option.isSome(existing)) {
          if (existing.value.status === "retired") {
            return yield* publicationFailed("A retired release cannot be staged again.");
          }
          return;
        }
        yield* sql`insert into inventory_dataset_release (id, status, createdAt, publishedAt) values (${releaseId}, 'staged', ${now}, null)`;
        yield* Effect.forEach(
          entries,
          (entry) =>
            sql`insert into inventory_release_entry (releaseId, organizationId, objectName, importId, status) values (${releaseId}, ${entry.organizationId}, ${entry.objectName}, ${entry.importId}, ${entry.status})`,
          { discard: true },
        );
      }).pipe(sql.withTransaction);
    }, persisting("stageRelease")),
    activateRelease: Effect.fn("Migrate.Directory.activateRelease")(function* (
      releaseId: InventoryReleaseId,
    ) {
      const now = unixSeconds(yield* Clock.currentTimeMillis);
      const pointer = yield* Effect.gen(function* () {
        const current = yield* selectActive(undefined);
        if (Option.isSome(current)) {
          if (current.value.releaseId !== releaseId) {
            return yield* publicationFailed("A different dataset release is already active.");
          }
          return current.value;
        }
        const staged = yield* selectRelease(releaseId);
        if (
          Option.isNone(staged) ||
          (staged.value.status !== "staged" && staged.value.status !== "active")
        ) {
          return yield* publicationFailed("The dataset release is not prepared for activation.");
        }
        yield* sql`update inventory_dataset_release set status = 'active', publishedAt = ${now} where id = ${releaseId} and status = 'staged'`;
        yield* sql`insert into inventory_active_release (id, releaseId, activatedAt) values (1, ${releaseId}, ${now})`;
        return ActiveReleasePointerSchema.make({ releaseId, activatedAtSeconds: now });
      }).pipe(sql.withTransaction);
      if (yield* Ref.getAndSet(lostActivation, false)) {
        return yield* publicationFailed("Publication response lost.");
      }
      return pointer;
    }, persisting("activateRelease")),
    readActiveRelease: Effect.fn("Migrate.Directory.readActiveRelease")(function* () {
      return yield* selectActive(undefined);
    }, persisting("readActiveRelease")),
    readReleaseStatus: Effect.fn("Migrate.Directory.readReleaseStatus")(function* (
      releaseId: InventoryReleaseId,
    ) {
      const row = yield* selectRelease(releaseId);
      return Option.map(row, (release) => release.status);
    }, persisting("readReleaseStatus")),
    loseNextActivation: Effect.fn("Migrate.Directory.loseNextActivation")(function* () {
      yield* Ref.set(lostActivation, true);
    }),
  };
};

const openDirectory = (sql: SqliteClient.SqliteClient) =>
  Effect.gen(function* () {
    yield* migrateDirectory(sql).pipe(Effect.orDie);
    return makeDirectory(sql, yield* Ref.make(false));
  });

export const sqliteDirectoryLayer = (
  sql: SqliteClient.SqliteClient,
): Layer.Layer<DatasetReleaseDirectory> =>
  Layer.effect(
    DatasetReleaseDirectory,
    Effect.gen(function* () {
      const service = yield* openDirectory(sql);
      return DatasetReleaseDirectory.of({
        ensureOrganization: service.ensureOrganization,
        stageRelease: service.stageRelease,
        activateRelease: service.activateRelease,
        readActiveRelease: service.readActiveRelease,
        readReleaseStatus: service.readReleaseStatus,
      });
    }),
  );

export const sqliteDirectoryTestLayer = (
  sql: SqliteClient.SqliteClient,
): Layer.Layer<DatasetReleaseDirectory | DatasetReleaseDirectoryTest> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const service = DatasetReleaseDirectoryTest.of(yield* openDirectory(sql));
      return Context.empty().pipe(
        Context.add(DatasetReleaseDirectory, service),
        Context.add(DatasetReleaseDirectoryTest, service),
      );
    }),
  );
