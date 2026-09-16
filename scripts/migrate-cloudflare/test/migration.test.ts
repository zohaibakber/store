import { it } from "@effect/vitest";
import { InventoryImportId } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import { describe, expect } from "vitest";

import { MigrationCheckpointTest } from "../src/checkpoint.ts";
import { DatasetReleaseDirectoryTest } from "../src/directory.ts";
import { ExportStore } from "../src/export-store.ts";
import { encodeRowsJson, rowsChecksum, translateCategory } from "../src/mapping.ts";
import { OrganizationInventoryImport } from "../src/target.ts";
import { runMigration } from "../src/workflow.ts";
import { ORG, openHarness, PUBLISHED_AT, request, runOn } from "./harness.ts";

const ImportId = Schema.decodeUnknownSync(InventoryImportId)("import-fixed");
const CountRow = Schema.Struct({ n: Schema.Number });
const decodeCount = Schema.decodeUnknownSync(CountRow);
const CategoryPackRow = Schema.Struct({ tracksPacks: Schema.Number, name: Schema.String });
const ProductVisibleRow = Schema.Struct({ visible: Schema.Number, unitPrice: Schema.Number });
const BatchQtyRow = Schema.Struct({ packQuantity: Schema.Number, unitQuantity: Schema.Number });
const InvoiceTotalRow = Schema.Struct({ total: Schema.Number });
const StateRow = Schema.Struct({
  epoch: Schema.String,
  incarnation: Schema.String,
  status: Schema.String,
});
const PointerRow = Schema.Struct({
  id: Schema.Number,
  releaseId: Schema.String,
  activatedAt: Schema.Number,
});
const ReleaseRow = Schema.Struct({ id: Schema.String, status: Schema.String });
const decodeCategoryPack = Schema.decodeUnknownSync(CategoryPackRow);
const decodeProductVisible = Schema.decodeUnknownSync(ProductVisibleRow);
const decodeBatchQty = Schema.decodeUnknownSync(BatchQtyRow);
const decodeInvoiceTotal = Schema.decodeUnknownSync(InvoiceTotalRow);
const decodeState = Schema.decodeUnknownSync(StateRow);
const decodePointers = Schema.decodeUnknownSync(Schema.Array(PointerRow));
const decodeReleases = Schema.decodeUnknownSync(Schema.Array(ReleaseRow));

describe("cloudflare migration action", () => {
  it.effect("translates booleans, money, and quantities into explicit SQLite values", () =>
    Effect.gen(function* () {
      const category = translateCategory({
        id: "cat-1",
        name: "General",
        tracksPacks: true,
        organizationId: ORG,
        createdByUserId: "user-1",
        updatedByUserId: "user-1",
        deviceId: "device-1",
        operationId: "op-cat-1",
        rowVersion: 1,
        createdAt: PUBLISHED_AT,
        updatedAt: PUBLISHED_AT,
        deletedAt: null,
      });
      expect(category.tracksPacks).toBe(1);
      const harness = openHarness();
      const result = yield* runOn(harness);
      expect(result.migrationId).toBe("migration-fixed");
      expect(result.importId).toBe("import-fixed");
      expect(result.releaseId).toBe("release-fixed");
      expect(result.publishedAt).toBe(PUBLISHED_AT);
      expect(result.organizationCount).toBe(1);
      expect(
        decodeCategoryPack(
          harness.target
            .prepare("select tracksPacks, name from categories where id = ?")
            .get("cat-1"),
        ),
      ).toEqual({ tracksPacks: 1, name: "General" });
      expect(
        decodeCategoryPack(
          harness.target
            .prepare("select tracksPacks, name from categories where id = ?")
            .get("cat-2"),
        ),
      ).toEqual({ tracksPacks: 0, name: "Loose" });
      expect(
        decodeProductVisible(
          harness.target
            .prepare("select visible, unitPrice from products where id = ?")
            .get("prod-1"),
        ),
      ).toEqual({ visible: 1, unitPrice: 10 });
      expect(
        decodeBatchQty(
          harness.target
            .prepare("select packQuantity, unitQuantity from batches where id = ?")
            .get("batch-1"),
        ),
      ).toEqual({ packQuantity: 2, unitQuantity: 5 });
      expect(
        decodeInvoiceTotal(
          harness.target.prepare("select total from invoices where id = ?").get("inv-1"),
        ),
      ).toEqual({
        total: 200,
      });
      expect(
        decodeState(
          harness.target.prepare("select epoch, incarnation, status from inventory_state").get(),
        ),
      ).toEqual({
        epoch: "1",
        incarnation: "incarnation-fixed",
        status: "ready",
      });
      expect(
        decodeCount(harness.target.prepare("select count(*) as n from replicas").get()).n,
      ).toBe(0);
      expect(
        decodeCount(harness.target.prepare("select count(*) as n from command_receipts").get()).n,
      ).toBe(0);
      harness.close();
    }),
  );

  it.effect("resumes an interrupted export and produces the identical manifest", () =>
    Effect.gen(function* () {
      const firstHarness = openHarness();
      const completed = yield* runOn(firstHarness);
      firstHarness.close();
      const harness = openHarness();
      const interrupted = yield* Effect.gen(function* () {
        yield* TestClock.setTime(PUBLISHED_AT);
        const checkpoint = yield* MigrationCheckpointTest;
        yield* checkpoint.failOnce("export.afterChunk");
        return yield* runMigration(request);
      }).pipe(Effect.provide(harness.layer), Effect.result);
      expect(Result.isFailure(interrupted)).toBe(true);
      if (Result.isFailure(interrupted)) {
        expect(interrupted.failure._tag).toBe("Migrate.Interrupted");
      }
      expect(
        decodeCount(harness.journal.prepare("select count(*) as n from export_chunk").get()).n,
      ).toBe(1);
      const resumed = yield* runOn(harness);
      expect(resumed).toEqual(completed);
      harness.close();
    }),
  );

  it.effect("applies an identical chunk twice without changing rows", () =>
    Effect.gen(function* () {
      const harness = openHarness();
      yield* runOn(harness);
      const outcome = yield* Effect.gen(function* () {
        const store = yield* ExportStore;
        const target = yield* OrganizationInventoryImport;
        const chunks = yield* store.loadChunks(ORG, "categories");
        expect(chunks.map((entry) => entry.chunkIndex)).toEqual([0, 1]);
        const chunk = chunks[0];
        if (chunk === undefined) {
          return yield* Effect.die("categories chunk 0 missing");
        }
        const before = yield* target.readTable(ORG, "categories");
        const again = yield* target.applyChunk(
          ORG,
          ImportId,
          "categories",
          chunk.chunkIndex,
          chunk.checksum,
          chunk.rowsJson,
        );
        const after = yield* target.readTable(ORG, "categories");
        return { again, before, after };
      }).pipe(Effect.provide(harness.layer));
      expect(outcome.again).toEqual({ _tag: "duplicate" });
      expect(outcome.after).toEqual(outcome.before);
      expect(outcome.before.length).toBe(3);
      harness.close();
    }),
  );

  it.effect("rejects a chunk whose identity collides with different bytes", () =>
    Effect.gen(function* () {
      const harness = openHarness();
      yield* runOn(harness);
      const rejected = yield* Effect.gen(function* () {
        const store = yield* ExportStore;
        const target = yield* OrganizationInventoryImport;
        const chunks = yield* store.loadChunks(ORG, "categories");
        expect(chunks.map((entry) => entry.chunkIndex)).toEqual([0, 1]);
        const chunk = chunks[0];
        if (chunk === undefined) {
          return yield* Effect.die("categories chunk 0 missing");
        }
        const rows = [
          {
            id: "cat-9",
            name: "Forged",
            tracksPacks: 0 as const,
            organizationId: ORG,
            createdByUserId: "user-1",
            updatedByUserId: "user-1",
            deviceId: "device-1",
            operationId: "op-forged",
            rowVersion: 1,
            createdAt: PUBLISHED_AT,
            updatedAt: PUBLISHED_AT,
            deletedAt: null,
          },
        ];
        return yield* target
          .applyChunk(
            ORG,
            ImportId,
            "categories",
            chunk.chunkIndex,
            rowsChecksum(rows),
            encodeRowsJson(rows),
          )
          .pipe(Effect.result);
      }).pipe(Effect.provide(harness.layer));
      expect(Result.isFailure(rejected)).toBe(true);
      if (Result.isFailure(rejected) && rejected.failure._tag === "Migrate.ChunkContentMismatch") {
        expect(rejected.failure.chunkIndex).toBe(0);
        expect(rejected.failure.table).toBe("categories");
      }
      expect(
        decodeCount(harness.target.prepare("select count(*) as n from categories").get()).n,
      ).toBe(3);
      harness.close();
    }),
  );

  it.effect("refuses to publish when a row count no longer matches the manifest", () =>
    Effect.gen(function* () {
      const harness = openHarness();
      const interrupted = yield* Effect.gen(function* () {
        yield* TestClock.setTime(PUBLISHED_AT);
        const checkpoint = yield* MigrationCheckpointTest;
        yield* checkpoint.failOnce("validate.before");
        return yield* runMigration(request);
      }).pipe(Effect.provide(harness.layer), Effect.result);
      expect(Result.isFailure(interrupted)).toBe(true);
      if (Result.isFailure(interrupted)) {
        expect(interrupted.failure._tag).toBe("Migrate.Interrupted");
      }
      harness.target
        .prepare(
          `insert into categories (id, name, tracksPacks, createdAt, updatedAt, deletedAt, organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion) values ('cat-x', 'Corrupt', 1, 1, 1, null, 'org-1', 'user-1', 'user-1', 'device-1', 'op-corrupt', 1)`,
        )
        .run();
      const failed = yield* runOn(harness).pipe(Effect.result);
      expect(Result.isFailure(failed)).toBe(true);
      if (Result.isFailure(failed) && failed.failure._tag === "Migrate.ValidationFailed") {
        expect(failed.failure.incompleteStep).toBe("validateRecords");
        expect(failed.failure.message).toBe(
          "Table categories row count 4 does not match manifest 3.",
        );
      }
      expect(
        decodeCount(
          harness.directory.prepare("select count(*) as n from inventory_active_release").get(),
        ).n,
      ).toBe(0);
      harness.close();
    }),
  );

  it.effect("resolves a lost publication response by reading the release back once", () =>
    Effect.gen(function* () {
      const harness = openHarness();
      const result = yield* Effect.gen(function* () {
        yield* TestClock.setTime(PUBLISHED_AT);
        const directory = yield* DatasetReleaseDirectoryTest;
        yield* directory.loseNextActivation();
        return yield* runMigration(request);
      }).pipe(Effect.provide(harness.layer));
      expect(result.releaseId).toBe("release-fixed");
      expect(result.publishedAt).toBe(PUBLISHED_AT);
      expect(
        decodePointers(
          harness.directory
            .prepare("select id, releaseId, activatedAt from inventory_active_release")
            .all(),
        ),
      ).toEqual([{ id: 1, releaseId: "release-fixed", activatedAt: 1_700_000_000 }]);
      expect(
        decodeReleases(
          harness.directory.prepare("select id, status from inventory_dataset_release").all(),
        ),
      ).toEqual([{ id: "release-fixed", status: "active" }]);
      const again = yield* runOn(harness);
      expect(again).toEqual(result);
      expect(
        decodePointers(
          harness.directory
            .prepare("select id, releaseId, activatedAt from inventory_active_release")
            .all(),
        ),
      ).toEqual([{ id: 1, releaseId: "release-fixed", activatedAt: 1_700_000_000 }]);
      harness.close();
    }),
  );

  it.effect("returns the original completed result when the action is repeated", () =>
    Effect.gen(function* () {
      const harness = openHarness();
      const first = yield* runOn(harness);
      const second = yield* runOn(harness);
      expect(first.migrationId).toBe("migration-fixed");
      expect(first.importId).toBe("import-fixed");
      expect(first.releaseId).toBe("release-fixed");
      expect(first.publishedAt).toBe(PUBLISHED_AT);
      expect(first.organizationCount).toBe(1);
      expect(second).toEqual(first);
      expect(
        decodeCount(
          harness.directory.prepare("select count(*) as n from inventory_active_release").get(),
        ).n,
      ).toBe(1);
      harness.close();
    }),
  );
});
