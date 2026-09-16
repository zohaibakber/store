import {
  compareDecimalSequence,
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
  stockMovements,
  stockOverlays,
} from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Schema from "effect/Schema";

import { runWrite } from "../sqlite";
import {
  loadReplicaState,
  overlayForAllocation,
  parseStoredEnvelope,
  type CommandOutboxStatus,
} from "./commands";
import type { ReplicaDb } from "./storage";

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

const applySnapshotRow = (tx: ReplicaDb, row: SnapshotPartPayload["rows"][number]): void => {
  const entity = row.entity;
  const table = entityTables[entity];
  const schema = syncEntityRows[entity].schema;
  const parsed = Schema.decodeUnknownSync(schema)(row.row);
  const existing = tx.select().from(table).where(eq(table.id, row.entityId)).get();
  if (existing && "rowVersion" in existing && existing.rowVersion > row.rowVersion) {
    return;
  }
  if (existing) {
    runWrite(tx.update(table).set(parsed).where(eq(table.id, row.entityId)));
    return;
  }
  runWrite(tx.insert(table).values(parsed));
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
    applySnapshotRow(tx, row);
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
