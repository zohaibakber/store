import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "@effect/vitest";
import {
  AuthorityIncarnation,
  OrgCommitSequence,
  SnapshotId,
  SnapshotPartHash,
  type SnapshotManifest,
  type SnapshotPartPayload,
  type SyncPullResult,
  type SyncTransactionGroup,
} from "@store/contracts";
import { decodeCategoryId } from "@store/contracts/ids";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import { commandOutbox, replicaState } from "@store/db/replica.schema";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";

import {
  beginSnapshotImport,
  importSnapshotPart,
  stepSnapshotActivation,
} from "../src/replica/import";
import type { ReplicaDb } from "../src/replica/sql-client/drizzle";
import {
  GENERATION_SEARCH_TABLES,
  GENERATION_TABLES,
  standbyTable,
} from "../src/replica/sqlite/generation";
import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import { openReplicaStore, runReplicaTransaction } from "../src/replica/storage";
import { enqueueRequestOf } from "./lib/enqueue";
import {
  CASE_PRODUCT_ID,
  catalogEnvelope,
  FIXTURE_NOW,
  NEW_CATEGORY_ID,
  ORDER_ID,
  ORDER_LINE_ID,
  placeOrderWrites,
  renameProductWrite,
  seedCatalogGroup,
  SUPPLIER_NAME,
} from "./lib/pending-fixture";
import { seedReplicaTenUnits, withSeededReplica } from "./lib/replica-fixture";

const workDirectory = mkdtempSync(join(tmpdir(), "generation-"));

afterAll(() => {
  rmSync(workDirectory, { recursive: true, force: true });
});

const managed = {
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  deletedAt: null,
  organizationId: LAST_UNIT_ORGANIZATION_ID,
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: LAST_UNIT_REPLICA_A,
  operationId: "snapshot",
  rowVersion: 3,
};

const snapshotId = SnapshotId.make("snapshot-generation");

const manifest: SnapshotManifest = {
  snapshotId,
  epoch: LAST_UNIT_EPOCH,
  subscription: "operational",
  schemaVersion: 1,
  horizon: OrgCommitSequence.make("3"),
  parts: [1, 2, 3].map((partNumber) => ({
    partNumber,
    byteLength: 1,
    sha256: SnapshotPartHash.make("a".repeat(64)),
  })),
  entityCounts: [],
  digestVersion: 3,
};

const productImage = (name: string) => ({
  id: LAST_UNIT_PRODUCT_ID,
  name,
  categoryId: "general",
  aisle: null,
  composition: null,
  strength: null,
  unitsPerPack: 1,
  purchasePrice: 50,
  retailPrice: 100,
  unitPrice: 100,
  visible: true,
  ...managed,
});

const partOf = (partNumber: number, rows: SnapshotPartPayload["rows"]): SnapshotPartPayload => ({
  snapshotId,
  partNumber,
  rows,
});

const parts: ReadonlyArray<SnapshotPartPayload> = [
  partOf(1, [
    {
      entity: "category",
      entityId: "general",
      rowVersion: 3,
      row: { id: "general", name: "General", tracksPacks: true, ...managed },
    },
    {
      entity: "product",
      entityId: LAST_UNIT_PRODUCT_ID,
      rowVersion: 3,
      row: productImage("Snapshot name"),
    },
    {
      entity: "supplier",
      entityId: "snapshot-supplier",
      rowVersion: 3,
      row: {
        id: "snapshot-supplier",
        name: "Snapshot wholesaler",
        phone: null,
        note: null,
        ...managed,
      },
    },
  ]),
  partOf(2, [
    {
      entity: "purchaseOrder",
      entityId: "snapshot-order",
      rowVersion: 3,
      row: {
        id: "snapshot-order",
        orderNumber: 1,
        supplierId: "snapshot-supplier",
        status: "sent",
        note: null,
        sentAt: FIXTURE_NOW,
        expectedAt: null,
        total: 100,
        ...managed,
      },
    },
    {
      entity: "purchaseOrderItem",
      entityId: "snapshot-order-line",
      rowVersion: 3,
      row: {
        id: "snapshot-order-line",
        purchaseOrderId: "snapshot-order",
        productId: LAST_UNIT_PRODUCT_ID,
        productName: "Snapshot name",
        quantity: 2,
        quantityType: "unit",
        baseUnitQuantity: 2,
        packCost: 50,
        receivedBaseUnits: 1,
        ...managed,
      },
    },
    {
      entity: "batch",
      entityId: LAST_UNIT_BATCH_ID,
      rowVersion: 3,
      row: {
        id: LAST_UNIT_BATCH_ID,
        productId: LAST_UNIT_PRODUCT_ID,
        batchNumber: "B-1",
        expiresAt: null,
        packQuantity: 0,
        unitQuantity: 8,
        ...managed,
      },
    },
  ]),
  partOf(3, []),
];

const remoteRename = (commitSequence: string, name: string): SyncTransactionGroup => ({
  commitSequence: OrgCommitSequence.make(commitSequence),
  operationId: `remote-${commitSequence}`,
  decision: "accepted",
  changes: [
    {
      entity: "product",
      action: "upsert",
      entityId: LAST_UNIT_PRODUCT_ID,
      rowVersion: 5,
      row: { ...productImage(name), operationId: `remote-${commitSequence}`, rowVersion: 5 },
    },
  ],
});

const categoryCommand = (index: number) =>
  enqueueRequestOf(
    catalogEnvelope({
      operationId: `local-category-${index}`,
      clientSequence: String(index + 10),
      writes: [
        {
          entity: "category",
          action: "upsert",
          id: decodeCategoryId(`${NEW_CATEGORY_ID}-${index}`),
          expectedRowVersion: null,
          row: { name: `Category ${index}`, tracksPacks: false },
        },
      ],
    }),
    index,
  );

const openAt = (path: string) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const handle = yield* openReplicaStore(path).pipe(Effect.provideService(Scope.Scope, scope));
    const store = yield* makeSqliteReplicaStore(handle, "generation-test");
    return { handle, store, close: Scope.close(scope, Exit.void) };
  });

type Open = Effect.Success<ReturnType<typeof openAt>>;

type DumpedRow = {
  readonly id?: string;
  readonly name?: string;
  readonly unitQuantity?: number;
  readonly orderNumber?: number;
  readonly receivedBaseUnits?: number;
  readonly entity?: string;
};

type SchemaDependent = {
  readonly type: string;
  readonly name: string;
  readonly tableName: string;
  readonly sql: string;
};

const schemaDependents = (tx: ReplicaDb) =>
  tx.all<SchemaDependent>(
    sql`select type, name, tbl_name as tableName, sql from sqlite_master where type in ('view', 'trigger') order by name`,
  );

const expectSearchTriggersFollowTheirTable = (dependents: ReadonlyArray<SchemaDependent>) => {
  expect(dependents.filter((dependent) => dependent.type !== "trigger")).toEqual([]);
  const twins = dependents.filter((trigger) => trigger.name.endsWith("__alt"));
  const primaries = dependents.filter((trigger) => !trigger.name.endsWith("__alt"));
  expect(twins.map((trigger) => trigger.name).sort()).toEqual(
    primaries.map((trigger) => `${trigger.name}__alt`).sort(),
  );
  expect(primaries.length).toBeGreaterThan(0);
  for (const trigger of dependents) {
    const onStandby = trigger.tableName.endsWith("_standby");
    expect(GENERATION_TABLES.some((table) => trigger.tableName.startsWith(table))).toBe(true);
    for (const search of GENERATION_SEARCH_TABLES) {
      expect(trigger.sql.includes(standbyTable(search))).toBe(onStandby);
    }
  }
};

const dumpState = (handle: Open["handle"]) =>
  runReplicaTransaction(handle, (tx) =>
    Effect.gen(function* () {
      const table = (name: string, order: string) =>
        tx.all<DumpedRow>(sql.raw(`select * from ${name} order by ${order}`));
      const state = yield* tx.select().from(replicaState).get();
      const outbox = yield* tx
        .select({ operationId: commandOutbox.operationId, status: commandOutbox.status })
        .from(commandOutbox)
        .all();
      return {
        state: {
          activeGeneration: state?.activeGeneration,
          appliedCommitSequence: state?.appliedCommitSequence,
        },
        outbox: outbox.sort((left, right) => left.operationId.localeCompare(right.operationId)),
        categories: yield* table("categories", "id"),
        products: yield* table("products", "id"),
        searchable: yield* tx.all<{ readonly id: string }>(
          sql.raw(
            `select id from products where rowid in (select rowid from products_search where products_search match '"' || replace(products.name, '"', '""') || '"') order by id`,
          ),
        ),
        searchEntries: yield* tx.get<{ readonly count: number }>(
          sql.raw("select count(*) as count from products_search_docsize"),
        ),
        triggers: yield* schemaDependents(tx),
        batches: yield* table("batches", "id"),
        suppliers: yield* table("suppliers", "id"),
        purchaseOrders: yield* table("purchase_orders", "id"),
        purchaseOrderItems: yield* table("purchase_order_items", "id"),
        marks: yield* table("pending_row_marks", "entity, entityId"),
        journal: yield* table("pending_row_journal", "operationId, entity, entityId"),
        overlays: yield* table("stock_overlays", "commandId, batchId"),
      };
    }),
  ).pipe(Effect.orDie);

type ScenarioEvent = (store: Open["store"]) => Effect.Effect<unknown, unknown>;

const scenario = (
  path: string,
  options: { readonly reopenEveryOperation: boolean; readonly abortEachStep: boolean },
  events: ReadonlyMap<number, ScenarioEvent>,
) =>
  Effect.gen(function* () {
    yield* Effect.scoped(seedReplicaTenUnits(path));
    let session = yield* openAt(path);
    const settle = Effect.gen(function* () {
      if (!options.reopenEveryOperation) return;
      yield* session.close;
      session = yield* openAt(path);
    });
    yield* session.store.applyTransactionGroup(seedCatalogGroup);
    yield* session.store.enqueueCommand(enqueueRequestOf(lastUnitBuyerAEnvelope, 1));
    yield* settle;
    yield* runReplicaTransaction(session.handle, (tx) => beginSnapshotImport(tx, manifest));
    yield* settle;
    for (const part of parts) {
      yield* runReplicaTransaction(session.handle, (tx) => importSnapshotPart(tx, manifest, part));
      yield* settle;
      const event = events.get(part.partNumber);
      if (event) yield* event(session.store);
      yield* settle;
    }
    let step = 0;
    while (true) {
      if (options.abortEachStep) {
        const aborted = yield* Effect.exit(
          runReplicaTransaction(session.handle, (tx) =>
            stepSnapshotActivation(tx, snapshotId).pipe(
              Effect.andThen(Effect.fail("interrupted mid-turn")),
            ),
          ),
        );
        expect(Exit.isFailure(aborted)).toBe(true);
      }
      const outcome = yield* runReplicaTransaction(session.handle, (tx) =>
        stepSnapshotActivation(tx, snapshotId),
      );
      yield* settle;
      step += 1;
      if (outcome._tag === "activated") break;
      if (outcome._tag === "needsAuthority") {
        return yield* Effect.die("the fixture never leaves the candidate behind");
      }
      const event = events.get(100 + step);
      if (event) yield* event(session.store);
      yield* settle;
    }
    const dump = yield* dumpState(session.handle);
    yield* session.close;
    return dump;
  });

const placeOrderCommand = enqueueRequestOf(
  catalogEnvelope({ operationId: "local-order", clientSequence: "9", writes: placeOrderWrites }),
  1,
);

const events = new Map<number, ScenarioEvent>([
  [
    1,
    (store) =>
      Effect.all([
        store.enqueueCommand(placeOrderCommand),
        store.enqueueCommand(categoryCommand(1)),
      ]),
  ],
  [2, (store) => store.applyTransactionGroup(remoteRename("2", "Remote before horizon"))],
  [101, (store) => store.applyTransactionGroup(remoteRename("4", "Remote after horizon"))],
  [
    102,
    (store) =>
      Effect.all([
        store.enqueueCommand(categoryCommand(2)),
        store.enqueueCommand(
          enqueueRequestOf(
            catalogEnvelope({
              operationId: "local-rename",
              clientSequence: "30",
              writes: [renameProductWrite("Local rename")],
            }),
            3,
          ),
        ),
      ]),
  ],
]);

describe("replica snapshot generations", () => {
  it.effect("keeps every standby table identical to its active table and free of dependents", () =>
    withSeededReplica((handle) =>
      runReplicaTransaction(handle, (tx) =>
        Effect.gen(function* () {
          const definitionOf = (table: string) =>
            Effect.gen(function* () {
              const columns = yield* tx.all<unknown>(sql.raw(`pragma table_info(${table})`));
              const indexes = yield* tx.all<{
                readonly name: string;
                readonly unique: number;
                readonly partial: number;
              }>(sql.raw(`pragma index_list(${table})`));
              const named = indexes.filter((index) => !index.name.startsWith("sqlite_autoindex_"));
              const detail = yield* Effect.forEach(named, (index) =>
                tx.all<unknown>(sql.raw(`pragma index_xinfo(${index.name})`)).pipe(
                  Effect.map((info) => ({
                    unique: index.unique,
                    partial: index.partial,
                    name: index.name,
                    info: JSON.stringify(info),
                  })),
                ),
              );
              return { columns: JSON.stringify(columns), detail };
            });
          expectSearchTriggersFollowTheirTable(yield* schemaDependents(tx));
          for (const search of GENERATION_SEARCH_TABLES) {
            const definitions = yield* tx.all<{ readonly name: string; readonly sql: string }>(
              sql`select name, sql from sqlite_master where name in (${search}, ${standbyTable(search)}) order by name`,
            );
            expect(definitions).toHaveLength(2);
            expect(definitions[1]?.sql.replace(standbyTable(search), search)).toBe(
              definitions[0]?.sql,
            );
          }
          for (const table of GENERATION_TABLES) {
            for (const name of [table, standbyTable(table)]) {
              expect(yield* tx.all<unknown>(sql.raw(`pragma foreign_key_list(${name})`))).toEqual(
                [],
              );
            }
            const active = yield* definitionOf(table);
            const standby = yield* definitionOf(standbyTable(table));
            expect(standby.columns.replaceAll(standbyTable(table), table)).toBe(active.columns);
            expect(standby.detail.map((index) => index.name).sort()).toEqual(
              active.detail.map((index) => `${index.name}__alt`).sort(),
            );
            expect(standby.detail.map((index) => `${index.unique}`).sort()).toEqual(
              active.detail.map((index) => `${index.unique}`).sort(),
            );
            expect(standby.detail.map((index) => `${index.partial}`).sort()).toEqual(
              active.detail.map((index) => `${index.partial}`).sort(),
            );
          }
        }),
      ).pipe(Effect.orDie),
    ),
  );

  it.effect("resumes every phase after a restart with the same result", () =>
    Effect.gen(function* () {
      const directory = join(workDirectory, "resume");
      const plain = { reopenEveryOperation: false, abortEachStep: false };
      const clean = yield* scenario(`${directory}-clean.sqlite`, plain, events);
      const restarted = yield* scenario(
        `${directory}-restarted.sqlite`,
        { reopenEveryOperation: true, abortEachStep: false },
        events,
      );
      const interrupted = yield* scenario(
        `${directory}-interrupted.sqlite`,
        { reopenEveryOperation: true, abortEachStep: true },
        events,
      );
      expect(restarted).toEqual(clean);
      expect(interrupted).toEqual(clean);
      expect(clean.state).toEqual({ activeGeneration: 2, appliedCommitSequence: "4" });
      expect(clean.outbox.map((row) => row.status)).toEqual([
        "pending",
        "pending",
        "pending",
        "pending",
        "pending",
      ]);
      expect(clean.suppliers.map((row) => row.name)).toEqual([
        "Snapshot wholesaler",
        SUPPLIER_NAME,
      ]);
      expect(clean.purchaseOrders.map((row) => [row.id, row.orderNumber])).toEqual([
        [ORDER_ID, 2],
        ["snapshot-order", 1],
      ]);
      expect(clean.purchaseOrderItems.map((row) => [row.id, row.receivedBaseUnits])).toEqual([
        [ORDER_LINE_ID, 0],
        ["snapshot-order-line", 1],
      ]);
      expect(clean.products.map((row) => row.id)).toEqual([LAST_UNIT_PRODUCT_ID, CASE_PRODUCT_ID]);
      expect(clean.categories.map((row) => row.name)).toEqual(
        expect.arrayContaining(["General", "Category 1", "Category 2"]),
      );
      expect(clean.products[0]?.name).toBe("Local rename");
      expect(clean.searchable.map((row) => row.id)).toEqual(clean.products.map((row) => row.id));
      expect(clean.searchEntries.count).toBe(clean.products.length);
      expectSearchTriggersFollowTheirTable(clean.triggers);
      expect(clean.batches[0]?.unitQuantity).toBe(8);
      expect(clean.overlays).toHaveLength(1);
      expect(clean.outbox.map((row) => row.operationId).sort()).toEqual(
        [
          lastUnitBuyerAEnvelope.operationId,
          "local-category-1",
          "local-category-2",
          "local-order",
          "local-rename",
        ].sort(),
      );
    }),
  );

  it.effect("re-fetches buffered parts after a restart and still activates", () =>
    Effect.gen(function* () {
      const path = join(workDirectory, "buffered.sqlite");
      yield* Effect.scoped(seedReplicaTenUnits(path));
      const first = yield* openAt(path);
      yield* first.store.beginSnapshotImport(manifest);
      yield* first.store.importSnapshotPart(manifest, parts[0]!);
      yield* first.close;
      const second = yield* openAt(path);
      const progress = yield* second.store.beginSnapshotImport(manifest);
      expect(progress.partsImported).toBe(0);
      for (const part of parts) yield* second.store.importSnapshotPart(manifest, part);
      const activated = yield* second.store.activateSnapshot(snapshotId);
      expect(activated.value._tag).toBe("activated");
      expect(activated.notice?.fullInvalidation).toBe(true);
      const dump = yield* dumpState(second.handle);
      expect(dump.state.activeGeneration).toBe(2);
      expect(dump.batches[0]?.unitQuantity).toBe(8);
      yield* second.close;
    }),
  );

  it.effect("splits parts larger than a turn and resumes a half-imported part", () =>
    Effect.gen(function* () {
      const splitId = SnapshotId.make("snapshot-split");
      const rowsPerPart = 1_200;
      const splitManifest: SnapshotManifest = {
        ...manifest,
        snapshotId: splitId,
        horizon: OrgCommitSequence.make("0"),
        parts: [1, 2, 3, 4, 5].map((partNumber) => ({
          partNumber,
          byteLength: 1,
          sha256: SnapshotPartHash.make("a".repeat(64)),
        })),
      };
      const splitParts = splitManifest.parts.map((entry) => ({
        snapshotId: splitId,
        partNumber: entry.partNumber,
        rows: Array.from({ length: rowsPerPart }, (_, index) => {
          const id = `c-${entry.partNumber}-${index}`;
          return {
            entity: "category" as const,
            entityId: id,
            rowVersion: 3,
            row: { id, name: `Category ${id}`, tracksPacks: true, ...managed },
          };
        }),
      }));
      const countOf = (handle: Open["handle"], table: string) =>
        runReplicaTransaction(handle, (tx) =>
          tx.get<{ readonly count: number }>(
            sql`select count(*) as count from ${sql.identifier(table)}`,
          ),
        ).pipe(Effect.map((row) => row?.count ?? 0));
      const path = join(workDirectory, "split.sqlite");
      yield* Effect.scoped(seedReplicaTenUnits(path));
      const first = yield* openAt(path);
      yield* first.store.beginSnapshotImport(splitManifest);
      for (const part of splitParts) yield* first.store.importSnapshotPart(splitManifest, part);
      const staged = yield* countOf(first.handle, "categories_standby");
      yield* first.close;
      const second = yield* openAt(path);
      const progress = yield* second.store.beginSnapshotImport(splitManifest);
      expect(progress.partsImported).toBeLessThan(splitParts.length);
      expect(staged).toBeGreaterThanOrEqual(progress.partsImported * rowsPerPart);
      for (const part of splitParts.slice(progress.partsImported)) {
        yield* second.store.importSnapshotPart(splitManifest, part);
      }
      const activated = yield* second.store.activateSnapshot(splitId);
      expect(activated.value._tag).toBe("activated");
      expect(yield* countOf(second.handle, "categories")).toBe(rowsPerPart * 5);
      yield* second.close;
    }),
  );

  it.effect("restarts an abandoned import of the same snapshot from scratch", () =>
    Effect.gen(function* () {
      const path = join(workDirectory, "restart.sqlite");
      yield* Effect.scoped(seedReplicaTenUnits(path));
      const session = yield* openAt(path);
      yield* runReplicaTransaction(session.handle, (tx) =>
        Effect.gen(function* () {
          yield* beginSnapshotImport(tx, manifest);
          yield* importSnapshotPart(tx, manifest, parts[0]!);
          yield* importSnapshotPart(tx, manifest, parts[1]!);
        }),
      );
      yield* session.store.abandonSnapshot(snapshotId);
      const restarted = yield* session.store.beginSnapshotImport(manifest);
      expect(restarted.partsImported).toBe(0);
      const standbyRows = yield* runReplicaTransaction(session.handle, (tx) =>
        Effect.forEach(GENERATION_TABLES, (table) =>
          tx.get<{ readonly count: number }>(
            sql`select count(*) as count from ${sql.identifier(standbyTable(table))}`,
          ),
        ),
      );
      expect(standbyRows.map((row) => row.count)).toEqual(GENERATION_TABLES.map(() => 0));
      yield* session.store.importSnapshotPart(manifest, {
        ...parts[0]!,
        rows: parts[0]!.rows.map((row) =>
          row.entity === "product" ? { ...row, row: productImage("Fresh name") } : row,
        ),
      });
      yield* session.store.importSnapshotPart(manifest, parts[1]!);
      yield* session.store.importSnapshotPart(manifest, parts[2]!);
      const activated = yield* session.store.activateSnapshot(snapshotId);
      expect(activated.value._tag).toBe("activated");
      const dump = yield* dumpState(session.handle);
      expect(dump.state.activeGeneration).toBe(2);
      expect(dump.products.map((row) => row.name)).toEqual(["Fresh name"]);
      expect(dump.batches[0]?.unitQuantity).toBe(8);
      yield* session.close;
    }),
  );
});

const importCandidate = (handle: Open["handle"]) =>
  runReplicaTransaction(handle, (tx) =>
    Effect.gen(function* () {
      yield* beginSnapshotImport(tx, manifest);
      for (const part of parts) yield* importSnapshotPart(tx, manifest, part);
    }),
  ).pipe(Effect.orDie);

const stepOnce = (handle: Open["handle"]) =>
  runReplicaTransaction(handle, (tx) => stepSnapshotActivation(tx, snapshotId)).pipe(Effect.orDie);

const importStage = (handle: Open["handle"]) =>
  runReplicaTransaction(handle, (tx) =>
    tx.get<{ readonly stage: string }>(sql`select stage from snapshot_imports`),
  ).pipe(
    Effect.map((row) => row.stage),
    Effect.orDie,
  );

describe("replica snapshot switch races", () => {
  it.effect("keeps stepping instead of activating while the journal is far ahead", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        const store = yield* makeSqliteReplicaStore(handle, "race");
        yield* importCandidate(handle);
        while ((yield* importStage(handle)) !== "replaying") yield* stepOnce(handle);
        for (let index = 1; index <= 20; index += 1) {
          yield* store.enqueueCommand(categoryCommand(index));
        }
        const first = yield* stepOnce(handle);
        expect(first._tag).toBe("progressed");
        let outcome = first;
        while (outcome._tag === "progressed") outcome = yield* stepOnce(handle);
        expect(outcome._tag).toBe("activated");
        const dump = yield* dumpState(handle);
        expect(dump.categories).toHaveLength(21);
        expect(dump.outbox).toHaveLength(20);
        expect(dump.marks.filter((mark) => mark.entity === "category")).toHaveLength(20);
      }),
    ),
  );

  it.effect("drops the shadow of a command the snapshot already covers", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        const store = yield* makeSqliteReplicaStore(handle, "covered");
        yield* store.enqueueCommand(enqueueRequestOf(lastUnitBuyerAEnvelope, 1));
        yield* importCandidate(handle);
        while ((yield* importStage(handle)) !== "replaying") yield* stepOnce(handle);
        yield* store.applyTransactionGroup({
          commitSequence: OrgCommitSequence.make("3"),
          operationId: lastUnitBuyerAEnvelope.operationId,
          decision: "accepted",
          changes: [],
        });
        let outcome = yield* stepOnce(handle);
        while (outcome._tag === "progressed") outcome = yield* stepOnce(handle);
        expect(outcome._tag).toBe("activated");
        const dump = yield* dumpState(handle);
        expect(dump.marks).toHaveLength(0);
        expect(dump.overlays).toHaveLength(0);
        expect(dump.outbox).toEqual([
          { operationId: lastUnitBuyerAEnvelope.operationId, status: "integrated" },
        ]);
        expect(dump.batches[0]?.unitQuantity).toBe(8);
      }),
    ),
  );

  it.effect("never activates a candidate that is behind the replica", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        const store = yield* makeSqliteReplicaStore(handle, "gap");
        yield* store.applyTransactionGroup(remoteRename("5", "Active five"));
        yield* importCandidate(handle);
        const first = yield* stepOnce(handle);
        expect(first).toEqual({
          _tag: "needsAuthority",
          afterCommitSequence: "3",
          throughCommitSequence: "5",
        });
        const page: SyncPullResult = {
          epoch: LAST_UNIT_EPOCH,
          incarnation: AuthorityIncarnation.make("incarnation-test"),
          subscription: "operational",
          schemaVersion: 1,
          transactions: [remoteRename("4", "Remote four"), remoteRename("5", "Remote five")],
          nextCommitSequence: OrgCommitSequence.make("5"),
          horizon: OrgCommitSequence.make("5"),
          retentionFloor: OrgCommitSequence.make("0"),
        };
        expect(yield* store.applyCandidateAuthority(snapshotId, page)).toBe("5");
        let outcome = yield* stepOnce(handle);
        while (outcome._tag === "progressed") outcome = yield* stepOnce(handle);
        expect(outcome._tag).toBe("activated");
        const dump = yield* dumpState(handle);
        expect(dump.products[0]?.name).toBe("Remote five");
        expect(dump.state.appliedCommitSequence).toBe("5");
      }),
    ),
  );
});
