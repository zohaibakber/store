import type { SyncEntityChange } from "@store/contracts";
import * as Effect from "effect/Effect";

import type { CatalogError } from "./errors";
import {
  applyRowChanges,
  emptyReplicaSnapshot,
  outboxEntryIdentity,
  changesForOutboxEntry,
  emptyReplicaRows,
  visibleReplicaSnapshot,
  type OutboxEntry,
  type ReplicaBootstrap,
  type ReplicaRows,
  type ReplicaSnapshot,
} from "./replica";

export type ReplicaStoreSnapshot = ReplicaSnapshot;

export type ReplicaStoreTransaction = {
  readonly appendOutbox: (entry: OutboxEntry) => boolean;
  readonly acknowledgeOutbox: (
    entryId: string,
    txid: number,
    changes?: ReadonlyArray<SyncEntityChange>,
  ) => void;
  readonly removeOutbox: (entryId: string) => void;
  readonly commitPull: (
    cursor: number,
    changes: ReadonlyArray<SyncEntityChange>,
    transactionEnd?: number,
  ) => void;
  readonly beginBootstrap: (bootstrap: ReplicaBootstrap) => void;
  readonly stageBootstrapPage: (
    generation: string,
    changes: ReadonlyArray<SyncEntityChange>,
    offset: number,
    done: boolean,
  ) => void;
  readonly activateBootstrap: (generation: string) => void;
  readonly discardBootstrap: (generation?: string) => void;
};

export interface ReplicaStoreApi {
  readonly load: (scopeKey: string) => Effect.Effect<ReplicaStoreSnapshot, CatalogError>;
  readonly transaction: <A>(
    scopeKey: string,
    update: (transaction: ReplicaStoreTransaction) => A,
  ) => Effect.Effect<{ readonly result: A; readonly snapshot: ReplicaStoreSnapshot }, CatalogError>;
}

const cloneRows = (rows: ReplicaRows): ReplicaRows => ({
  category: [...rows.category],
  product: [...rows.product],
  batch: [...rows.batch],
  invoice: [...rows.invoice],
  invoiceItem: [...rows.invoiceItem],
  stockMovement: [...rows.stockMovement],
});

const optimisticChangesFor = (
  entry: OutboxEntry,
  changes: ReadonlyArray<SyncEntityChange> | undefined,
) => changes ?? changesForOutboxEntry(entry);

const withoutOutbox = (outbox: ReadonlyArray<OutboxEntry>, entryId: string) =>
  outbox.filter((entry) => outboxEntryIdentity(entry) !== entryId);

const applyOverlay = (
  snapshot: ReplicaSnapshot,
  txid: number,
  changes: ReadonlyArray<SyncEntityChange>,
): ReplicaSnapshot => {
  const overlays = (snapshot.overlays ?? []).filter((overlay) => overlay.txid !== txid);
  overlays.push({ txid, changes: [...changes] });
  return { ...snapshot, overlays };
};

export const applyReplicaTransaction = <A>(
  initial: ReplicaSnapshot,
  operation: (transaction: ReplicaStoreTransaction) => A,
) => {
  let snapshot = initial;
  const transaction: ReplicaStoreTransaction = {
    appendOutbox: (entry) => {
      const identity = outboxEntryIdentity(entry);
      if (snapshot.outbox.some((candidate) => outboxEntryIdentity(candidate) === identity))
        return false;
      snapshot = {
        ...snapshot,
        outbox: [...snapshot.outbox, entry],
      };
      return true;
    },
    acknowledgeOutbox: (entryId, txid, changes) => {
      const entry = snapshot.outbox.find((candidate) => outboxEntryIdentity(candidate) === entryId);
      if (!entry) return;
      const overlay = optimisticChangesFor(entry, changes);
      if (txid > snapshot.cursor) snapshot = applyOverlay(snapshot, txid, overlay);
      snapshot = { ...snapshot, outbox: withoutOutbox(snapshot.outbox, entryId) };
    },
    removeOutbox: (entryId) => {
      snapshot = { ...snapshot, outbox: withoutOutbox(snapshot.outbox, entryId) };
    },
    commitPull: (cursor, changes, transactionEnd = cursor) => {
      if (cursor < snapshot.cursor) return;
      const nextRows = applyRowChanges(snapshot.rows, changes);
      const overlays = (snapshot.overlays ?? []).filter((overlay) => overlay.txid > transactionEnd);
      snapshot = { ...snapshot, cursor, rows: nextRows, overlays };
    },
    beginBootstrap: (bootstrap) => {
      snapshot = { ...snapshot, bootstrap: { ...bootstrap, rows: emptyReplicaRows() } };
    },
    stageBootstrapPage: (generation, changes, offset, done) => {
      const bootstrap = snapshot.bootstrap;
      if (!bootstrap || bootstrap.generation !== generation) return;
      const staged = applyRowChanges(bootstrap.rows ?? emptyReplicaRows(), changes);
      snapshot = {
        ...snapshot,
        bootstrap: { ...bootstrap, offset, done, rows: staged },
      };
    },
    activateBootstrap: (generation) => {
      const bootstrap = snapshot.bootstrap;
      if (!bootstrap || bootstrap.generation !== generation || !bootstrap.done) return;
      snapshot = {
        ...snapshot,
        cursor: bootstrap.cursor,
        initialized: true,
        overlays: (snapshot.overlays ?? []).filter((overlay) => overlay.txid > bootstrap.cursor),
        rows: bootstrap.rows ?? emptyReplicaRows(),
        bootstrap: undefined,
      };
    },
    discardBootstrap: (generation) => {
      if (generation && snapshot.bootstrap?.generation !== generation) return;
      snapshot = { ...snapshot, bootstrap: undefined };
    },
  };
  const result = operation(transaction);
  return { result, snapshot };
};

export const makeMemoryReplicaStore = (
  seed: Readonly<Record<string, ReplicaStoreSnapshot>> = {},
): ReplicaStoreApi => {
  const states = new Map<string, ReplicaStoreSnapshot>(
    Object.entries(seed).map(([key, value]) => [key, { ...value, rows: cloneRows(value.rows) }]),
  );
  return {
    load: (scopeKey) => Effect.sync(() => states.get(scopeKey) ?? emptyReplicaSnapshot()),
    transaction: (scopeKey, update) =>
      Effect.sync(() => {
        const initial = states.get(scopeKey) ?? emptyReplicaSnapshot();
        const { result, snapshot } = applyReplicaTransaction(initial, update);
        states.set(scopeKey, snapshot);
        return { result, snapshot };
      }),
  };
};

export const visibleRowsForStore = (snapshot: ReplicaStoreSnapshot): ReplicaRows =>
  visibleReplicaSnapshot(snapshot).rows;
