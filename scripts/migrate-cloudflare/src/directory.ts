import {
  InventoryImportId,
  InventoryObjectName,
  InventoryReleaseId,
  OrganizationId,
} from "@store/contracts";
import type Database from "better-sqlite3";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { PersistenceError, PublicationFailed } from "./errors.ts";
import {
  type ActiveReleasePointer,
  ActiveReleasePointer as ActiveReleasePointerSchema,
} from "./model.ts";
import { migrateDirectory, runSqliteTransaction } from "./sqlite.ts";

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

const malformed = (operation: string): PersistenceError =>
  persistenceFail(operation, new Error(`Directory ${operation} row failed schema checks.`));

const unixSeconds = (millis: number): number => Math.floor(millis / 1000);

const OrganizationIdRow = Schema.Struct({ id: Schema.String });
const ReleaseRow = Schema.Struct({ id: Schema.String, status: Schema.String });
const StatusRow = Schema.Struct({ status: Schema.String });
const ActiveRow = Schema.Struct({
  releaseId: Schema.String,
  activatedAt: Schema.Number,
});
const decodeOrganizationIdRow = Schema.decodeUnknownOption(OrganizationIdRow);
const decodeReleaseRow = Schema.decodeUnknownOption(ReleaseRow);
const decodeStatusRow = Schema.decodeUnknownOption(StatusRow);
const decodeActiveRow = Schema.decodeUnknownOption(ActiveRow);

const makeDirectory = (
  sqlite: Database.Database,
  lostActivation: Ref.Ref<boolean>,
): DatasetReleaseDirectoryTestApi => {
  const selectOrg = sqlite.prepare("select id from auth_organization where id = ?");
  const insertOrg = sqlite.prepare(
    "insert into auth_organization (id, name, slug, createdAt, updatedAt) values (?, ?, ?, ?, ?)",
  );
  const selectRelease = sqlite.prepare(
    "select id, status from inventory_dataset_release where id = ?",
  );
  const insertRelease = sqlite.prepare(
    "insert into inventory_dataset_release (id, status, createdAt, publishedAt) values (?, 'staged', ?, null)",
  );
  const insertEntry = sqlite.prepare(
    "insert into inventory_release_entry (releaseId, organizationId, objectName, importId, status) values (?, ?, ?, ?, ?)",
  );
  const activateReleaseRow = sqlite.prepare(
    "update inventory_dataset_release set status = 'active', publishedAt = ? where id = ? and status = 'staged'",
  );
  const selectActive = sqlite.prepare(
    "select releaseId, activatedAt from inventory_active_release where id = 1",
  );
  const insertActive = sqlite.prepare(
    "insert into inventory_active_release (id, releaseId, activatedAt) values (1, ?, ?)",
  );

  const decodePointer = (
    row: typeof ActiveRow.Type,
  ): Effect.Effect<ActiveReleasePointer, PersistenceError> =>
    Schema.decodeUnknownEffect(ActiveReleasePointerSchema)({
      releaseId: row.releaseId,
      activatedAtSeconds: row.activatedAt,
    }).pipe(Effect.mapError((cause) => persistenceFail("readActiveRelease", cause)));

  return {
    ensureOrganization: Effect.fn("Migrate.Directory.ensureOrganization")(function* (
      organizationId: OrganizationId,
    ) {
      const now = unixSeconds(yield* Clock.currentTimeMillis);
      yield* Effect.try({
        try: () => {
          const raw = selectOrg.get(organizationId);
          if (raw !== undefined) {
            if (Option.isNone(decodeOrganizationIdRow(raw))) {
              throw malformed("ensureOrganization");
            }
            return;
          }
          insertOrg.run(organizationId, organizationId, organizationId, now, now);
        },
        catch: (cause) => {
          if (cause instanceof PersistenceError) return cause;
          return persistenceFail("ensureOrganization", cause);
        },
      });
    }),
    stageRelease: Effect.fn("Migrate.Directory.stageRelease")(function* (
      releaseId: InventoryReleaseId,
      entries: ReadonlyArray<ReleaseEntry>,
    ) {
      if (entries.length === 0) {
        return yield* Effect.fail(
          new PublicationFailed({
            incompleteStep: "publishDataset",
            message: "A dataset release requires at least one organization entry.",
          }),
        );
      }
      const now = unixSeconds(yield* Clock.currentTimeMillis);
      yield* Effect.try({
        try: () =>
          runSqliteTransaction(sqlite, () => {
            const raw = selectRelease.get(releaseId);
            if (raw !== undefined) {
              const existing = decodeReleaseRow(raw);
              if (Option.isNone(existing)) {
                throw malformed("stageRelease");
              }
              if (existing.value.status === "retired") {
                throw new PublicationFailed({
                  incompleteStep: "publishDataset",
                  message: "A retired release cannot be staged again.",
                });
              }
              return;
            }
            insertRelease.run(releaseId, now);
            for (const entry of entries) {
              insertEntry.run(
                releaseId,
                entry.organizationId,
                entry.objectName,
                entry.importId,
                entry.status,
              );
            }
          }),
        catch: (cause) => {
          if (cause instanceof PublicationFailed || cause instanceof PersistenceError) return cause;
          return persistenceFail("stageRelease", cause);
        },
      });
    }),
    activateRelease: Effect.fn("Migrate.Directory.activateRelease")(function* (
      releaseId: InventoryReleaseId,
    ) {
      const now = unixSeconds(yield* Clock.currentTimeMillis);
      const pointer = yield* Effect.try({
        try: () =>
          runSqliteTransaction(sqlite, () => {
            const currentRaw = selectActive.get();
            if (currentRaw !== undefined) {
              const current = decodeActiveRow(currentRaw);
              if (Option.isNone(current)) {
                throw malformed("activateRelease");
              }
              if (current.value.releaseId !== releaseId) {
                throw new PublicationFailed({
                  incompleteStep: "publishDataset",
                  message: "A different dataset release is already active.",
                });
              }
              return current.value;
            }
            const stagedRaw = selectRelease.get(releaseId);
            const staged = stagedRaw === undefined ? Option.none() : decodeReleaseRow(stagedRaw);
            if (
              Option.isNone(staged) ||
              (staged.value.status !== "staged" && staged.value.status !== "active")
            ) {
              throw new PublicationFailed({
                incompleteStep: "publishDataset",
                message: "The dataset release is not prepared for activation.",
              });
            }
            activateReleaseRow.run(now, releaseId);
            insertActive.run(releaseId, now);
            return { releaseId, activatedAt: now };
          }),
        catch: (cause) => {
          if (cause instanceof PublicationFailed || cause instanceof PersistenceError) return cause;
          return persistenceFail("activateRelease", cause);
        },
      });
      const lose = yield* Ref.get(lostActivation);
      if (lose) {
        yield* Ref.set(lostActivation, false);
        return yield* Effect.fail(
          new PublicationFailed({
            incompleteStep: "publishDataset",
            message: "Publication response lost.",
          }),
        );
      }
      return yield* decodePointer(pointer);
    }),
    readActiveRelease: Effect.fn("Migrate.Directory.readActiveRelease")(function* () {
      const row = yield* Effect.try({
        try: () => selectActive.get(),
        catch: (cause) => persistenceFail("readActiveRelease", cause),
      });
      if (row === undefined) return Option.none();
      const parsed = decodeActiveRow(row);
      if (Option.isNone(parsed)) return yield* Effect.fail(malformed("readActiveRelease"));
      return Option.some(yield* decodePointer(parsed.value));
    }),
    readReleaseStatus: Effect.fn("Migrate.Directory.readReleaseStatus")(function* (
      releaseId: InventoryReleaseId,
    ) {
      const row = yield* Effect.try({
        try: () => selectRelease.get(releaseId),
        catch: (cause) => persistenceFail("readReleaseStatus", cause),
      });
      if (row === undefined) return Option.none();
      const parsed = decodeStatusRow(row);
      if (Option.isNone(parsed)) return yield* Effect.fail(malformed("readReleaseStatus"));
      return Option.some(parsed.value.status);
    }),
    loseNextActivation: Effect.fn("Migrate.Directory.loseNextActivation")(function* () {
      yield* Ref.set(lostActivation, true);
    }),
  };
};

export const sqliteDirectoryLayer = (
  sqlite: Database.Database,
): Layer.Layer<DatasetReleaseDirectory> =>
  Layer.effect(
    DatasetReleaseDirectory,
    Effect.gen(function* () {
      migrateDirectory(sqlite);
      const lostActivation = yield* Ref.make(false);
      const service = makeDirectory(sqlite, lostActivation);
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
  sqlite: Database.Database,
): Layer.Layer<DatasetReleaseDirectory | DatasetReleaseDirectoryTest> =>
  Layer.effectContext(
    Effect.gen(function* () {
      migrateDirectory(sqlite);
      const lostActivation = yield* Ref.make(false);
      const service = DatasetReleaseDirectoryTest.of(makeDirectory(sqlite, lostActivation));
      return Context.empty().pipe(
        Context.add(DatasetReleaseDirectory, service),
        Context.add(DatasetReleaseDirectoryTest, service),
      );
    }),
  );
