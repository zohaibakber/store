import {
  compareDecimalSequence,
  SyncEntity,
  syncProtocolError,
  type SnapshotManifest,
  type SnapshotPartPayload,
  type SyncSubscription,
} from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import {
  batches,
  categories,
  commandOutbox,
  invoiceItems,
  invoices,
  products,
  replicaState,
  snapshotImports,
  snapshotStagedRows,
  stockMovements,
  stockOverlays,
} from "@store/db/replica.schema";
import { and, eq } from "drizzle-orm";
import * as Schema from "effect/Schema";

import { runWrite } from "../sqlite";
import {
  loadReplicaState,
  overlayForAllocation,
  parseStoredEnvelope,
  type CommandOutboxStatus,
} from "./commands";
import type { ReplicaDb } from "./storage";

const encodeRowJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const parseSubscription = (subscription: string): SyncSubscription => {
  if (subscription === "operational") return "operational";
  throw syncProtocolError("SCHEMA_VERSION_UNSUPPORTED", "The snapshot subscription is invalid.");
};

export type SnapshotActivation = {
  readonly activeGeneration: number;
  readonly subscription: SyncSubscription;
};

export type SnapshotImportStage =
  | { readonly _tag: "importing"; readonly partsImported: number; readonly partsTotal: number }
  | { readonly _tag: "caught_up"; readonly throughCommitSequence: string }
  | { readonly _tag: "activated" };

const entityTables = {
  category: categories,
  product: products,
  batch: batches,
  invoice: invoices,
  invoiceItem: invoiceItems,
  stockMovement: stockMovements,
} as const;

const stageSnapshotRow = (
  tx: ReplicaDb,
  snapshotId: string,
  row: SnapshotPartPayload["rows"][number],
): void => {
  const schema = syncEntityRows[row.entity].schema;
  Schema.decodeUnknownSync(schema)(row.row);
  const existing = tx
    .select()
    .from(snapshotStagedRows)
    .where(
      and(
        eq(snapshotStagedRows.snapshotId, snapshotId),
        eq(snapshotStagedRows.entity, row.entity),
        eq(snapshotStagedRows.entityId, row.entityId),
      ),
    )
    .get();
  if (existing && existing.rowVersion > row.rowVersion) return;
  const rowJson = encodeRowJson(row.row);
  if (existing) {
    runWrite(
      tx
        .update(snapshotStagedRows)
        .set({ rowVersion: row.rowVersion, rowJson })
        .where(
          and(
            eq(snapshotStagedRows.snapshotId, snapshotId),
            eq(snapshotStagedRows.entity, row.entity),
            eq(snapshotStagedRows.entityId, row.entityId),
          ),
        ),
    );
    return;
  }
  runWrite(
    tx.insert(snapshotStagedRows).values({
      snapshotId,
      entity: row.entity,
      entityId: row.entityId,
      rowVersion: row.rowVersion,
      rowJson,
    }),
  );
};

const promoteStagedRow = (
  tx: ReplicaDb,
  entity: SyncEntity,
  entityId: string,
  rowJson: string,
): void => {
  const table = entityTables[entity];
  const schema = syncEntityRows[entity].schema;
  const parsed = Schema.decodeUnknownSync(Schema.fromJsonString(schema))(rowJson);
  const existing = tx.select().from(table).where(eq(table.id, entityId)).get();
  if (existing) {
    runWrite(tx.update(table).set(parsed).where(eq(table.id, entityId)));
    return;
  }
  runWrite(tx.insert(table).values(parsed));
};

const promoteStagedSnapshot = (tx: ReplicaDb, snapshotId: string): void => {
  const staged = [
    ...tx
      .select()
      .from(snapshotStagedRows)
      .where(eq(snapshotStagedRows.snapshotId, snapshotId))
      .all(),
  ].sort((left, right) => {
    const order = (entity: string): number => {
      switch (entity) {
        case "category":
          return 0;
        case "product":
          return 1;
        case "batch":
          return 2;
        case "invoice":
          return 3;
        case "invoiceItem":
          return 4;
        case "stockMovement":
          return 5;
        default:
          return 6;
      }
    };
    return order(left.entity) - order(right.entity);
  });
  for (const row of staged) {
    promoteStagedRow(
      tx,
      Schema.decodeUnknownSync(SyncEntity)(row.entity),
      row.entityId,
      row.rowJson,
    );
  }
  runWrite(tx.delete(snapshotStagedRows).where(eq(snapshotStagedRows.snapshotId, snapshotId)));
};

export const beginSnapshotImport = (
  tx: ReplicaDb,
  manifest: SnapshotManifest,
): SnapshotImportStage => {
  const state = loadReplicaState(tx);
  const existing = tx
    .select()
    .from(snapshotImports)
    .where(eq(snapshotImports.snapshotId, manifest.snapshotId))
    .get();
  if (existing) {
    if (existing.stage === "activated") return { _tag: "activated" };
    if (existing.stage === "caught_up") {
      return {
        _tag: "caught_up",
        throughCommitSequence: existing.horizon,
      };
    }
    return {
      _tag: "importing",
      partsImported: existing.partsImported,
      partsTotal: existing.partsTotal,
    };
  }
  runWrite(
    tx.insert(snapshotImports).values({
      snapshotId: manifest.snapshotId,
      generation: state.activeGeneration + 1,
      subscription: manifest.subscription,
      horizon: manifest.horizon,
      stage: "importing",
      partsImported: 0,
      partsTotal: manifest.parts.length,
    }),
  );
  return { _tag: "importing", partsImported: 0, partsTotal: manifest.parts.length };
};

export const importSnapshotPart = (
  tx: ReplicaDb,
  manifest: SnapshotManifest,
  part: SnapshotPartPayload,
): SnapshotImportStage => {
  const importRow = tx
    .select()
    .from(snapshotImports)
    .where(eq(snapshotImports.snapshotId, manifest.snapshotId))
    .get();
  if (!importRow || importRow.stage === "activated") {
    throw syncProtocolError("SNAPSHOT_UNAVAILABLE", "The snapshot import is not active.");
  }
  const manifestPart = manifest.parts.find((entry) => entry.partNumber === part.partNumber);
  if (!manifestPart) {
    throw syncProtocolError("SNAPSHOT_UNAVAILABLE", "The snapshot part is not in the manifest.");
  }
  if (part.snapshotId !== manifest.snapshotId) {
    throw syncProtocolError("SNAPSHOT_UNAVAILABLE", "The snapshot part identity does not match.");
  }
  if (part.partNumber <= importRow.partsImported) {
    if (importRow.stage === "caught_up") {
      return { _tag: "caught_up", throughCommitSequence: importRow.horizon };
    }
    return {
      _tag: "importing",
      partsImported: importRow.partsImported,
      partsTotal: importRow.partsTotal,
    };
  }
  if (part.partNumber !== importRow.partsImported + 1) {
    throw syncProtocolError("SNAPSHOT_UNAVAILABLE", "The snapshot part arrived out of order.");
  }
  for (const row of part.rows) {
    stageSnapshotRow(tx, manifest.snapshotId, row);
  }
  const partsImported = importRow.partsImported + 1;
  const stage = partsImported === importRow.partsTotal ? "caught_up" : "importing";
  runWrite(
    tx
      .update(snapshotImports)
      .set({ partsImported, stage })
      .where(eq(snapshotImports.snapshotId, manifest.snapshotId)),
  );
  if (stage === "caught_up") {
    return { _tag: "caught_up", throughCommitSequence: importRow.horizon };
  }
  return { _tag: "importing", partsImported, partsTotal: importRow.partsTotal };
};

const integrateCoveredCommands = (tx: ReplicaDb, horizon: string): void => {
  const covered = tx
    .select()
    .from(commandOutbox)
    .where(eq(commandOutbox.status, "accepted_awaiting_integration"))
    .all()
    .filter(
      (row) =>
        row.commitSequence !== null && compareDecimalSequence(row.commitSequence, horizon) <= 0,
    );
  for (const row of covered) {
    runWrite(
      tx
        .update(commandOutbox)
        .set({ status: "integrated" })
        .where(eq(commandOutbox.operationId, row.operationId)),
    );
    runWrite(tx.delete(stockOverlays).where(eq(stockOverlays.commandId, row.operationId)));
  }
};

const recomputePendingOverlays = (tx: ReplicaDb): void => {
  runWrite(tx.delete(stockOverlays));
  const pending = tx
    .select()
    .from(commandOutbox)
    .where(eq(commandOutbox.status, "pending"))
    .all()
    .concat(
      tx
        .select()
        .from(commandOutbox)
        .where(eq(commandOutbox.status, "accepted_awaiting_integration"))
        .all(),
    )
    .sort((left, right) => compareDecimalSequence(left.clientSequence, right.clientSequence));
  for (const row of pending) {
    const envelope = parseStoredEnvelope(row);
    for (const overlay of overlayForAllocation(tx, envelope)) {
      runWrite(tx.insert(stockOverlays).values(overlay));
    }
  }
};

export const activateSnapshotGeneration = (
  tx: ReplicaDb,
  snapshotId: string,
): SnapshotActivation => {
  const importRow = tx
    .select()
    .from(snapshotImports)
    .where(eq(snapshotImports.snapshotId, snapshotId))
    .get();
  if (!importRow || importRow.stage !== "caught_up") {
    throw syncProtocolError("SNAPSHOT_UNAVAILABLE", "The snapshot is not ready to activate.");
  }
  const state = loadReplicaState(tx);
  promoteStagedSnapshot(tx, snapshotId);
  integrateCoveredCommands(tx, importRow.horizon);
  recomputePendingOverlays(tx);
  runWrite(
    tx
      .update(replicaState)
      .set({
        activeGeneration: importRow.generation,
        appliedCommitSequence: importRow.horizon,
        localCommitVersion: state.localCommitVersion + 1,
      })
      .where(eq(replicaState.id, state.id)),
  );
  runWrite(
    tx
      .update(snapshotImports)
      .set({ stage: "activated" })
      .where(eq(snapshotImports.snapshotId, snapshotId)),
  );
  return {
    activeGeneration: importRow.generation,
    subscription: parseSubscription(importRow.subscription),
  };
};

export const markSnapshotCaughtUp = (
  tx: ReplicaDb,
  snapshotId: string,
  throughCommitSequence: string,
): void => {
  const importRow = tx
    .select()
    .from(snapshotImports)
    .where(eq(snapshotImports.snapshotId, snapshotId))
    .get();
  if (!importRow) return;
  if (compareDecimalSequence(throughCommitSequence, importRow.horizon) < 0) return;
  runWrite(
    tx
      .update(snapshotImports)
      .set({ stage: "caught_up" })
      .where(eq(snapshotImports.snapshotId, snapshotId)),
  );
};

export const snapshotImportStatus = (
  tx: ReplicaDb,
  snapshotId: string,
): SnapshotImportStage | undefined => {
  const importRow = tx
    .select()
    .from(snapshotImports)
    .where(eq(snapshotImports.snapshotId, snapshotId))
    .get();
  if (!importRow) return undefined;
  if (importRow.stage === "activated") return { _tag: "activated" };
  if (importRow.stage === "caught_up") {
    return { _tag: "caught_up", throughCommitSequence: importRow.horizon };
  }
  return {
    _tag: "importing",
    partsImported: importRow.partsImported,
    partsTotal: importRow.partsTotal,
  };
};

export const pendingOutboxCount = (tx: ReplicaDb): number =>
  tx
    .select({ operationId: commandOutbox.operationId })
    .from(commandOutbox)
    .where(eq(commandOutbox.status, "pending"))
    .all().length +
  tx
    .select({ operationId: commandOutbox.operationId })
    .from(commandOutbox)
    .where(eq(commandOutbox.status, "sending"))
    .all().length +
  tx
    .select({ operationId: commandOutbox.operationId })
    .from(commandOutbox)
    .where(eq(commandOutbox.status, "accepted_awaiting_integration"))
    .all().length;

export const outboxStatus = (tx: ReplicaDb, operationId: string): CommandOutboxStatus | undefined =>
  tx.select().from(commandOutbox).where(eq(commandOutbox.operationId, operationId)).get()?.status;
