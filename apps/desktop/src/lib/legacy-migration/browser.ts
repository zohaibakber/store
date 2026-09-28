import {
  CommandOutcome,
  decodeBatchSqliteRows,
  decodeCategorySqliteRows,
  decodeInvoiceSqliteRows,
  decodeProductSqliteRows,
  MAX_COMMAND_OUTCOME_IDS,
  MAX_IN_VALUES,
  ReplicaSyncProgress,
  type InventorySubsetSpec,
  type ReplicaHandle,
  type SqliteResultRow,
  type SubsetPredicate,
} from "@store/client-db";
import { enqueueReplicaCommand, type InventoryActor } from "@store/inventory-react";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { LegacyMigrationBridge } from "../../../electron/legacy-migration-channels";
import {
  LegacyArchive,
  LegacyDatabaseCapture,
  LegacyMigrationState,
  LegacyPurgeResult,
  LEGACY_DATABASE_PREFIX,
} from "./model";
import type { LegacyReplicaSnapshot, LegacySnapshotNeeds } from "./plan";
import {
  legacyMigrationFailure,
  type LegacyMigrationFailure,
  type LegacyDatabaseProbe,
  type LegacyFilesPort,
  type LegacyReplicaPort,
  type LegacyStorePort,
} from "./run";

const MAX_SUBSET_ROWS = 100_000;
const DELETE_DATABASE_TIMEOUT = "30 seconds";

const decodeCapture = Schema.decodeUnknownEffect(LegacyDatabaseCapture);
const decodeProbe = Schema.decodeUnknownEffect(
  Schema.Struct({ pendingWrites: Schema.Int, invoiceRows: Schema.Int }),
);
const decodeState = Schema.decodeUnknownEffect(Schema.NullOr(LegacyMigrationState));
const decodeArchive = Schema.decodeUnknownEffect(LegacyArchive);
const decodeArchiveFile = Schema.decodeUnknownEffect(Schema.Struct({ file: Schema.String }));
const decodeBoolean = Schema.decodeUnknownEffect(Schema.Boolean);
const decodePurge = Schema.decodeUnknownEffect(LegacyPurgeResult);
const decodeOutcomes = Schema.decodeUnknownEffect(Schema.Array(CommandOutcome));
const decodeProgress = Schema.decodeUnknownEffect(ReplicaSyncProgress);

const loadReader = () => import("./powersync-reader");

export const browserLegacyStore = (
  indexedDb: IDBFactory,
  storage: Pick<Storage, "getItem" | "removeItem">,
): LegacyStorePort => ({
  listDatabases: Effect.tryPromise({
    try: () => indexedDb.databases(),
    catch: legacyMigrationFailure("list-databases"),
  }).pipe(
    Effect.map((databases) =>
      databases.flatMap((database) =>
        database.name?.startsWith(LEGACY_DATABASE_PREFIX) ? [database.name] : [],
      ),
    ),
  ),
  readDatabase: (name) =>
    Effect.tryPromise({
      try: () => loadReader().then((reader) => reader.readLegacyPowerSyncDatabase(name)),
      catch: legacyMigrationFailure("read-database"),
    }).pipe(
      Effect.flatMap(decodeCapture),
      Effect.mapError(legacyMigrationFailure("read-database")),
    ),
  probeDatabase: (name) =>
    Effect.tryPromise({
      try: () => loadReader().then((reader) => reader.probeLegacyPowerSyncDatabase(name)),
      catch: legacyMigrationFailure("probe-database"),
    }).pipe(
      Effect.flatMap(decodeProbe),
      Effect.map((probe): LegacyDatabaseProbe => probe),
      Effect.mapError(legacyMigrationFailure("probe-database")),
    ),
  deleteDatabase: (name) =>
    Effect.callback<void, LegacyMigrationFailure>((resume) => {
      const request = indexedDb.deleteDatabase(name);
      request.onsuccess = () => resume(Effect.void);
      request.onerror = () =>
        resume(Effect.fail(legacyMigrationFailure("delete-database")(request.error)));
    }).pipe(
      Effect.timeoutOrElse({
        duration: DELETE_DATABASE_TIMEOUT,
        orElse: () =>
          Effect.fail(
            legacyMigrationFailure("delete-database")(
              `Deleting ${name} stayed blocked by an open connection.`,
            ),
          ),
      }),
    ),
  readSaleOutbox: (key) =>
    Effect.try({ try: () => storage.getItem(key), catch: legacyMigrationFailure("read-journal") }),
  removeSaleOutbox: (key) =>
    Effect.try({
      try: () => storage.removeItem(key),
      catch: legacyMigrationFailure("remove-journal"),
    }),
});

const bridgeCall = <A>(step: string, call: () => Promise<A>) =>
  Effect.tryPromise({ try: call, catch: legacyMigrationFailure(step) });

export const bridgeLegacyFiles = (bridge: LegacyMigrationBridge): LegacyFilesPort => ({
  readState: (organizationId) =>
    bridgeCall("read-state", () => bridge.readState(organizationId)).pipe(
      Effect.flatMap(decodeState),
      Effect.mapError(legacyMigrationFailure("read-state")),
    ),
  writeState: (state) => bridgeCall("write-state", () => bridge.writeState(state)),
  writeArchive: (archive) =>
    bridgeCall("write-archive", () => bridge.writeArchive(archive)).pipe(
      Effect.flatMap(decodeArchiveFile),
      Effect.map((written) => written.file),
      Effect.mapError(legacyMigrationFailure("write-archive")),
    ),
  readArchive: (file) =>
    bridgeCall("read-archive", () => bridge.readArchive(file)).pipe(
      Effect.flatMap(decodeArchive),
      Effect.mapError(legacyMigrationFailure("read-archive")),
    ),
  archiveExists: (file) =>
    bridgeCall("archive-exists", () => bridge.archiveExists(file)).pipe(
      Effect.flatMap(decodeBoolean),
      Effect.mapError(legacyMigrationFailure("archive-exists")),
    ),
  writeReport: (report) => bridgeCall("write-report", () => bridge.writeReport(report)),
  purgeDeadFiles: bridgeCall("purge-dead-files", () => bridge.purgeDeadFiles()).pipe(
    Effect.flatMap(decodePurge),
    Effect.map((result) => result.removed),
    Effect.mapError(legacyMigrationFailure("purge-dead-files")),
  ),
});

const replicaCall = <A>(step: string, call: () => Promise<A>) =>
  Effect.tryPromise({ try: call, catch: legacyMigrationFailure(step) });

const commitWakes = (replica: ReplicaHandle) =>
  Stream.callback<void>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          replica.subscribe((notice) => {
            if (notice.workspaceToken === replica.workspaceToken) {
              Queue.offerUnsafe(queue, undefined);
            }
          }),
        ),
        (unsubscribe) => Effect.sync(unsubscribe),
      ),
    { bufferSize: 1, strategy: "sliding" },
  );

const inPredicate = (column: string, values: ReadonlyArray<string | number>): SubsetPredicate => ({
  _tag: "in",
  column,
  values,
});

export const replicaLegacyPort = (
  replica: ReplicaHandle,
  actor: InventoryActor,
): LegacyReplicaPort => {
  const readRows = (spec: InventorySubsetSpec) =>
    replicaCall("read-replica", () => replica.readSubset(spec)).pipe(
      Effect.map((read): ReadonlyArray<SqliteResultRow> => read.rows),
    );

  const readIn = <Row>(
    source: InventorySubsetSpec["source"],
    column: string,
    values: ReadonlyArray<string | number>,
    decode: (rows: ReadonlyArray<SqliteResultRow>) => Effect.Effect<ReadonlyArray<Row>, unknown>,
  ) =>
    Effect.forEach(Arr.chunksOf([...new Set(values)], MAX_IN_VALUES), (chunk) =>
      readRows({
        source,
        where: inPredicate(column, chunk),
        orderBy: [],
        limit: MAX_SUBSET_ROWS,
        offset: 0,
      }).pipe(Effect.flatMap(decode), Effect.mapError(legacyMigrationFailure("read-replica"))),
    ).pipe(Effect.map((chunks) => chunks.flat()));

  const loadSnapshot = Effect.fn("LegacyMigration.loadSnapshot")(function* (
    needs: LegacySnapshotNeeds,
  ) {
    const categories = yield* readRows({
      source: "categories",
      orderBy: [{ column: "id", direction: "asc" }],
      limit: MAX_SUBSET_ROWS,
      offset: 0,
    }).pipe(
      Effect.flatMap(decodeCategorySqliteRows),
      Effect.mapError(legacyMigrationFailure("read-replica")),
    );
    const products = [
      ...(yield* readIn("products", "id", needs.productIds, decodeProductSqliteRows)),
      ...(yield* readIn(
        "products",
        "categoryId",
        needs.productCategoryIds,
        decodeProductSqliteRows,
      )),
    ];
    const batches = [
      ...(yield* readIn("batches", "id", needs.batchIds, decodeBatchSqliteRows)),
      ...(yield* readIn("batches", "productId", needs.batchProductIds, decodeBatchSqliteRows)),
    ];
    const invoices = [
      ...(yield* readIn("invoices", "id", needs.invoiceIds, decodeInvoiceSqliteRows)),
      ...(yield* readIn(
        "invoices",
        "invoiceNumber",
        needs.invoiceNumbers,
        decodeInvoiceSqliteRows,
      )),
    ];
    const newest = yield* readRows({
      source: "invoices",
      orderBy: [{ column: "invoiceNumber", direction: "desc" }],
      limit: 1,
      offset: 0,
    }).pipe(
      Effect.flatMap(decodeInvoiceSqliteRows),
      Effect.mapError(legacyMigrationFailure("read-replica")),
    );
    return {
      categories,
      products: [...new Map(products.map((row) => [row.id, row])).values()],
      batches: [...new Map(batches.map((row) => [row.id, row])).values()],
      invoiceIds: new Set(invoices.map((row) => row.id)),
      invoiceNumbers: new Set(invoices.map((row) => row.invoiceNumber)),
      maxInvoiceNumber: newest[0]?.invoiceNumber ?? 0,
    } satisfies LegacyReplicaSnapshot;
  });

  const readOutcomes = (operationIds: ReadonlyArray<string>) => {
    const read = replica.readCommandOutcomes;
    if (read === undefined) {
      return Effect.fail(
        legacyMigrationFailure("read-outcomes")("This replica cannot report command outcomes."),
      );
    }
    return Effect.forEach(Arr.chunksOf([...operationIds], MAX_COMMAND_OUTCOME_IDS), (chunk) =>
      replicaCall("read-outcomes", () => read(chunk)).pipe(
        Effect.flatMap(decodeOutcomes),
        Effect.mapError(legacyMigrationFailure("read-outcomes")),
      ),
    ).pipe(Effect.map((chunks) => chunks.flat()));
  };

  const readProgress = replica.readSyncProgress;

  return {
    wakes: commitWakes(replica),
    syncProgress:
      readProgress === undefined
        ? Effect.fail(
            legacyMigrationFailure("sync-progress")("This replica cannot report progress."),
          )
        : replicaCall("sync-progress", readProgress).pipe(
            Effect.flatMap(decodeProgress),
            Effect.mapError(legacyMigrationFailure("sync-progress")),
          ),
    readOutcomes,
    loadSnapshot,
    enqueue: (request) =>
      replicaCall("enqueue", () =>
        enqueueReplicaCommand(
          replica,
          actor,
          request.operationId,
          request.command,
          request.occurredAt,
        ),
      ).pipe(Effect.asVoid),
    wakeUpload: Effect.sync(() => replica.wakeSyncUpload?.()),
  };
};
