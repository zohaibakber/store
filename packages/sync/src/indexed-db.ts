import { SyncEntity, SyncEntityChange } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { CatalogError } from "./errors";
import { applyReplicaTransaction } from "./persistence";
import type { ReplicaStoreTransaction } from "./persistence";
import {
  emptyReplicaRows,
  diffReplicaRows,
  outboxEntryIdentity,
  OutboxEntry,
  ReplicaBootstrap,
  type ReplicaSnapshot as ReplicaSnapshotValue,
} from "./replica";
import { ReplicaStore } from "./store";

const META = "meta";
const ROWS = "rows";
const OUTBOX = "outbox";
const OVERLAYS = "overlays";
const BOOTSTRAP_ROWS = "bootstrapRows";
const VERSION = 2;

const RowRecord = Schema.Struct({
  scopeKey: Schema.String,
  entity: SyncEntity,
  id: Schema.String,
  row: Schema.Json,
});
type RowRecord = typeof RowRecord.Type;
const BootstrapRowRecord = Schema.Struct({ ...RowRecord.fields, generation: Schema.String });
const OutboxRecord = Schema.Struct({
  scopeKey: Schema.String,
  identity: Schema.String,
  sequence: Schema.String,
  entry: OutboxEntry,
});
const OverlayRecord = Schema.Struct({
  scopeKey: Schema.String,
  txid: Schema.Number,
  changes: Schema.Array(SyncEntityChange),
});
const MetaRecord = Schema.Struct({
  scopeKey: Schema.String,
  revision: Schema.optionalKey(Schema.String),
  initialized: Schema.optionalKey(Schema.Boolean),
  cursor: Schema.optionalKey(Schema.Number),
  bootstrap: Schema.optionalKey(ReplicaBootstrap),
});

const storageError = (message: string) =>
  new CatalogError({ reason: "rejected", code: "REPLICA_STORAGE", message });

const openDatabase = Effect.fn("ReplicaStore.open")((name: string) =>
  Effect.callback<IDBDatabase, CatalogError>((resume) => {
    const request = indexedDB.open(name, VERSION);
    let cancelled = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      if (!db.objectStoreNames.contains(ROWS))
        db.createObjectStore(ROWS, { keyPath: ["scopeKey", "entity", "id"] });
      if (!db.objectStoreNames.contains(OUTBOX))
        db.createObjectStore(OUTBOX, { keyPath: ["scopeKey", "identity"] });
      if (!db.objectStoreNames.contains(OVERLAYS))
        db.createObjectStore(OVERLAYS, { keyPath: ["scopeKey", "txid"] });
      if (!db.objectStoreNames.contains(BOOTSTRAP_ROWS))
        db.createObjectStore(BOOTSTRAP_ROWS, {
          keyPath: ["scopeKey", "generation", "entity", "id"],
        });
    };
    request.onsuccess = () => {
      if (cancelled) request.result.close();
      else resume(Effect.succeed(request.result));
    };
    request.onerror = () =>
      resume(
        Effect.fail(storageError(request.error?.message ?? "Unable to open the local replica.")),
      );
    return Effect.sync(() => {
      cancelled = true;
    });
  }),
);

const transactionToEffect = <A>(
  db: IDBDatabase,
  names: ReadonlyArray<string>,
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction, complete: (result: A) => void) => void,
) =>
  Effect.callback<A, CatalogError>((resume) => {
    const tx = db.transaction([...names], mode);
    let result: A;
    let active = true;
    tx.oncomplete = () => {
      active = false;
      resume(Effect.succeed(result));
    };
    tx.onabort = () => {
      active = false;
      resume(Effect.fail(storageError(tx.error?.message ?? "Local replica transaction aborted.")));
    };
    try {
      run(tx, (value) => {
        result = value;
      });
    } catch {
      tx.abort();
    }
    return Effect.sync(() => {
      if (active) tx.abort();
    });
  });

const rowsFromRecords = (records: ReadonlyArray<RowRecord>): ReplicaSnapshotValue["rows"] => {
  const rows = {
    category: [...emptyReplicaRows().category],
    product: [...emptyReplicaRows().product],
    batch: [...emptyReplicaRows().batch],
    invoice: [...emptyReplicaRows().invoice],
    invoiceItem: [...emptyReplicaRows().invoiceItem],
    stockMovement: [...emptyReplicaRows().stockMovement],
  };
  for (const record of records) {
    rows[record.entity].push(record.row);
  }
  return rows;
};

type CachedReplica = { revision: string; snapshot: ReplicaSnapshotValue };

const readState = (
  tx: IDBTransaction,
  scopeKey: string,
  cache: Map<string, CachedReplica>,
  loaded: (snapshot: ReplicaSnapshotValue, revision: string) => void,
) => {
  const state = tx.objectStore(META).get(`state:${scopeKey}`);
  state.onsuccess = () => {
    try {
      const meta = Schema.decodeUnknownSync(Schema.UndefinedOr(MetaRecord))(state.result);
      const revision = meta?.revision ?? "";
      const cached = cache.get(scopeKey);
      if (cached?.revision === revision) {
        loaded(cached.snapshot, revision);
        return;
      }
      const range = IDBKeyRange.bound([scopeKey], [scopeKey, []]);
      const rows = tx.objectStore(ROWS).getAll(range);
      const outbox = tx.objectStore(OUTBOX).getAll(range);
      const overlays = tx.objectStore(OVERLAYS).getAll(range);
      const bootstrapRows = tx.objectStore(BOOTSTRAP_ROWS).getAll(range);
      bootstrapRows.onsuccess = () => {
        try {
          const bootstrap = meta?.bootstrap;
          loaded(
            {
              cursor: meta?.cursor ?? 0,
              initialized: meta?.initialized ?? false,
              rows: rowsFromRecords(Schema.decodeUnknownSync(Schema.Array(RowRecord))(rows.result)),
              outbox: [...Schema.decodeUnknownSync(Schema.Array(OutboxRecord))(outbox.result)]
                .sort((a, b) => a.sequence.localeCompare(b.sequence))
                .map((entry) => entry.entry),
              overlays: [...Schema.decodeUnknownSync(Schema.Array(OverlayRecord))(overlays.result)]
                .sort((a, b) => a.txid - b.txid)
                .map((entry) => ({ txid: entry.txid, changes: entry.changes })),
              bootstrap: bootstrap
                ? {
                    ...bootstrap,
                    rows: rowsFromRecords(
                      Schema.decodeUnknownSync(Schema.Array(BootstrapRowRecord))(
                        bootstrapRows.result,
                      ).filter((entry) => entry.generation === bootstrap.generation),
                    ),
                  }
                : undefined,
            },
            revision,
          );
        } catch {
          tx.abort();
        }
      };
    } catch {
      tx.abort();
    }
  };
};

const writeRows = (
  store: IDBObjectStore,
  scopeKey: string,
  before: ReplicaSnapshotValue["rows"],
  after: ReplicaSnapshotValue["rows"],
  generation?: string,
) => {
  for (const { entity, upserts, deletes } of diffReplicaRows(before, after)) {
    for (const { id, row } of upserts) {
      store.put(
        generation === undefined
          ? { scopeKey, entity, id, row }
          : { scopeKey, generation, entity, id, row },
      );
    }
    for (const id of deletes) {
      store.delete(
        generation === undefined ? [scopeKey, entity, id] : [scopeKey, generation, entity, id],
      );
    }
  }
};

const writeDiff = (
  tx: IDBTransaction,
  scopeKey: string,
  before: ReplicaSnapshotValue,
  after: ReplicaSnapshotValue,
  revision: string,
) => {
  writeRows(tx.objectStore(ROWS), scopeKey, before.rows, after.rows);
  const oldOutbox = new Map(before.outbox.map((entry) => [outboxEntryIdentity(entry), entry]));
  const newOutbox = new Map(after.outbox.map((entry) => [outboxEntryIdentity(entry), entry]));
  const outbox = tx.objectStore(OUTBOX);
  for (const [index, entry] of after.outbox.entries()) {
    if (before.outbox[index] === entry) continue;
    outbox.put({
      scopeKey,
      identity: outboxEntryIdentity(entry),
      sequence: String(index).padStart(16, "0"),
      entry,
    });
  }
  for (const identity of oldOutbox.keys())
    if (!newOutbox.has(identity)) outbox.delete([scopeKey, identity]);
  const oldOverlays = new Map((before.overlays ?? []).map((overlay) => [overlay.txid, overlay]));
  const newOverlays = new Map((after.overlays ?? []).map((overlay) => [overlay.txid, overlay]));
  const overlays = tx.objectStore(OVERLAYS);
  for (const [txid, overlay] of newOverlays)
    if (oldOverlays.get(txid) !== overlay)
      overlays.put({ scopeKey, txid, changes: overlay.changes });
  for (const txid of oldOverlays.keys())
    if (!newOverlays.has(txid)) overlays.delete([scopeKey, txid]);
  tx.objectStore(META).put(
    {
      scopeKey,
      revision,
      initialized: after.initialized ?? false,
      cursor: after.cursor,
      bootstrap: after.bootstrap ? { ...after.bootstrap, rows: undefined } : undefined,
    },
    `state:${scopeKey}`,
  );
  const bootstrapRows = tx.objectStore(BOOTSTRAP_ROWS);
  const oldBootstrap = before.bootstrap;
  const newBootstrap = after.bootstrap;
  if (oldBootstrap && (!newBootstrap || oldBootstrap.generation !== newBootstrap.generation)) {
    writeRows(
      bootstrapRows,
      scopeKey,
      oldBootstrap.rows ?? emptyReplicaRows(),
      emptyReplicaRows(),
      oldBootstrap.generation,
    );
  }
  if (newBootstrap && newBootstrap !== oldBootstrap) {
    const previousRows =
      oldBootstrap?.generation === newBootstrap.generation
        ? (oldBootstrap.rows ?? emptyReplicaRows())
        : emptyReplicaRows();
    writeRows(
      bootstrapRows,
      scopeKey,
      previousRows,
      newBootstrap.rows ?? emptyReplicaRows(),
      newBootstrap.generation,
    );
  }
};

export const layerIndexedDbReplica = (name: string) =>
  Layer.effect(
    ReplicaStore,
    Effect.gen(function* () {
      const db = yield* Effect.acquireRelease(openDatabase(name), (handle) =>
        Effect.sync(() => handle.close()),
      );
      const stores = [META, ROWS, OUTBOX, OVERLAYS, BOOTSTRAP_ROWS];
      const cache = new Map<string, CachedReplica>();
      const load = Effect.fn("ReplicaStore.load")((scopeKey: string) =>
        transactionToEffect<CachedReplica>(db, stores, "readonly", (tx, complete) => {
          readState(tx, scopeKey, cache, (snapshot, revision) => complete({ snapshot, revision }));
        }).pipe(
          Effect.tap((value) => Effect.sync(() => cache.set(scopeKey, value))),
          Effect.map((value) => value.snapshot),
        ),
      );
      const transaction = Effect.fn("ReplicaStore.transaction")(
        <A>(scopeKey: string, update: (transaction: ReplicaStoreTransaction) => A) =>
          transactionToEffect<CachedReplica & { result: A }>(
            db,
            stores,
            "readwrite",
            (tx, complete) => {
              readState(tx, scopeKey, cache, (before) => {
                const { result, snapshot } = applyReplicaTransaction(before, update);
                const revision = crypto.randomUUID();
                writeDiff(tx, scopeKey, before, snapshot, revision);
                complete({ result, snapshot, revision });
              });
            },
          ).pipe(Effect.tap((value) => Effect.sync(() => cache.set(scopeKey, value)))),
      );
      return ReplicaStore.of({ load, transaction });
    }),
  );
