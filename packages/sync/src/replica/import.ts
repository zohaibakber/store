import {
  CATALOG_PARTITION_DIGEST_VERSION,
  compareDecimalSequence,
  digestVersionEntities,
  PartitionDigestVersion,
  snapshotDigestVersion,
  syncProtocolError,
  type SnapshotManifest,
  type SnapshotPartPayload,
  type SyncEntity,
  type SyncSubscription,
} from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import {
  commandOutbox,
  replicaState,
  snapshotImports,
  snapshotStagedRows,
  stockOverlays,
} from "@store/db/replica.schema";
import { eq, inArray, sql } from "drizzle-orm";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { decodeEntity, decodeRowJson, decodeSubscription, encodeRowJson } from "./codecs";
import { loadReplicaState, loadStockIndex, parseStoredEnvelope } from "./commands";
import { byClientSequence, byEntityDependency, decideOverlays } from "./decisions";
import { clearPendingProjection, reapplyPendingProjections } from "./pending";
import { clearEntityRows, insertEntityRows, writeEntityRow } from "./rows";
import type { ReplicaDb } from "./sql-client/drizzle";

type SnapshotActivation = {
  readonly activeGeneration: number;
  readonly subscription: SyncSubscription;
};

type SnapshotImportStage =
  | { readonly _tag: "importing"; readonly partsImported: number; readonly partsTotal: number }
  | { readonly _tag: "caught_up"; readonly throughCommitSequence: string }
  | { readonly _tag: "activated" };

const stageOf = (row: {
  readonly stage: string;
  readonly horizon: string;
  readonly partsImported: number;
  readonly partsTotal: number;
}): SnapshotImportStage => {
  if (row.stage === "activated") return { _tag: "activated" };
  if (row.stage === "caught_up") return { _tag: "caught_up", throughCommitSequence: row.horizon };
  return { _tag: "importing", partsImported: row.partsImported, partsTotal: row.partsTotal };
};

const STAGED_ROWS_PER_STATEMENT = 500;

const stageSnapshotRows = Effect.fn("ReplicaImport.stageSnapshotRows")(function* (
  tx: ReplicaDb,
  snapshotId: string,
  rows: SnapshotPartPayload["rows"],
) {
  const staged = rows.map((row) => {
    Schema.decodeUnknownSync(syncEntityRows[row.entity].schema)(row.row);
    return {
      snapshotId,
      entity: row.entity,
      entityId: row.entityId,
      rowVersion: row.rowVersion,
      rowJson: encodeRowJson(row.row),
    };
  });
  for (const chunk of Array.chunksOf(staged, STAGED_ROWS_PER_STATEMENT)) {
    yield* tx
      .insert(snapshotStagedRows)
      .values(chunk)
      .onConflictDoUpdate({
        target: [
          snapshotStagedRows.snapshotId,
          snapshotStagedRows.entity,
          snapshotStagedRows.entityId,
        ],
        set: {
          rowVersion: sql`excluded.${sql.identifier(snapshotStagedRows.rowVersion.name)}`,
          rowJson: sql`excluded.${sql.identifier(snapshotStagedRows.rowJson.name)}`,
        },
        setWhere: sql`excluded.${sql.identifier(snapshotStagedRows.rowVersion.name)} >= ${snapshotStagedRows.rowVersion}`,
      });
  }
});

const decodeDigestVersion = Schema.decodeUnknownOption(PartitionDigestVersion);

const importDigestVersion = (stored: number | null): PartitionDigestVersion =>
  Option.getOrElse(decodeDigestVersion(stored), () => CATALOG_PARTITION_DIGEST_VERSION);

const promoteStagedSnapshot = Effect.fn("ReplicaImport.promoteStagedSnapshot")(function* (
  tx: ReplicaDb,
  snapshotId: string,
  digestVersion: PartitionDigestVersion,
) {
  const rows = yield* tx
    .select()
    .from(snapshotStagedRows)
    .where(eq(snapshotStagedRows.snapshotId, snapshotId))
    .all();
  const replaced = new Set<SyncEntity>(digestVersionEntities(digestVersion));
  for (const entity of replaced) {
    yield* clearEntityRows(tx, entity);
  }
  const staged = Array.groupBy(rows, (row) => decodeEntity(row.entity));
  const entities = Array.sort(
    Object.keys(staged).map((key) => ({ entity: decodeEntity(key) })),
    byEntityDependency,
  );
  for (const { entity } of entities) {
    const decoded = (staged[entity] ?? []).map((row) => decodeRowJson(row.rowJson));
    if (replaced.has(entity)) {
      yield* insertEntityRows(tx, entity, decoded);
      continue;
    }
    for (const row of decoded) {
      yield* writeEntityRow(tx, entity, row);
    }
  }
  yield* tx.delete(snapshotStagedRows).where(eq(snapshotStagedRows.snapshotId, snapshotId));
});

export const beginSnapshotImport = Effect.fn("ReplicaImport.beginSnapshotImport")(function* (
  tx: ReplicaDb,
  manifest: SnapshotManifest,
) {
  const state = yield* loadReplicaState(tx);
  const existing = yield* tx
    .select()
    .from(snapshotImports)
    .where(eq(snapshotImports.snapshotId, manifest.snapshotId))
    .get();
  if (existing) return stageOf(existing);
  yield* tx.insert(snapshotImports).values({
    snapshotId: manifest.snapshotId,
    generation: state.activeGeneration + 1,
    subscription: manifest.subscription,
    horizon: manifest.horizon,
    stage: "importing",
    partsImported: 0,
    partsTotal: manifest.parts.length,
    digestVersion: snapshotDigestVersion(manifest),
  });
  return stageOf({
    stage: "importing",
    horizon: manifest.horizon,
    partsImported: 0,
    partsTotal: manifest.parts.length,
  });
});

export const importSnapshotPart = Effect.fn("ReplicaImport.importSnapshotPart")(function* (
  tx: ReplicaDb,
  manifest: SnapshotManifest,
  part: SnapshotPartPayload,
) {
  const importRow = yield* tx
    .select()
    .from(snapshotImports)
    .where(eq(snapshotImports.snapshotId, manifest.snapshotId))
    .get();
  if (!importRow || importRow.stage === "activated") {
    return yield* Effect.fail(
      syncProtocolError("SNAPSHOT_UNAVAILABLE", "The snapshot import is not active."),
    );
  }
  const manifestPart = manifest.parts.find((entry) => entry.partNumber === part.partNumber);
  if (!manifestPart) {
    return yield* Effect.fail(
      syncProtocolError("SNAPSHOT_UNAVAILABLE", "The snapshot part is not in the manifest."),
    );
  }
  if (part.snapshotId !== manifest.snapshotId) {
    return yield* Effect.fail(
      syncProtocolError("SNAPSHOT_UNAVAILABLE", "The snapshot part identity does not match."),
    );
  }
  if (part.partNumber <= importRow.partsImported) {
    return stageOf(importRow);
  }
  if (part.partNumber !== importRow.partsImported + 1) {
    return yield* Effect.fail(
      syncProtocolError("SNAPSHOT_UNAVAILABLE", "The snapshot part arrived out of order."),
    );
  }
  yield* stageSnapshotRows(tx, manifest.snapshotId, part.rows);
  const partsImported = importRow.partsImported + 1;
  const stage = partsImported === importRow.partsTotal ? "caught_up" : "importing";
  yield* tx
    .update(snapshotImports)
    .set({ partsImported, stage })
    .where(eq(snapshotImports.snapshotId, manifest.snapshotId));
  return stageOf({ ...importRow, partsImported, stage });
});

const integrateCoveredCommands = Effect.fn("ReplicaImport.integrateCoveredCommands")(function* (
  tx: ReplicaDb,
  horizon: string,
) {
  const rows = yield* tx
    .select()
    .from(commandOutbox)
    .where(eq(commandOutbox.status, "accepted_awaiting_integration"))
    .all();
  const covered = rows.filter(
    (row) =>
      row.commitSequence !== null && compareDecimalSequence(row.commitSequence, horizon) <= 0,
  );
  for (const row of covered) {
    yield* tx
      .update(commandOutbox)
      .set({ status: "integrated" })
      .where(eq(commandOutbox.operationId, row.operationId));
    yield* tx.delete(stockOverlays).where(eq(stockOverlays.commandId, row.operationId));
    yield* clearPendingProjection(tx, row.operationId);
  }
});

const recomputePendingOverlays = Effect.fn("ReplicaImport.recomputePendingOverlays")(function* (
  tx: ReplicaDb,
) {
  yield* tx.delete(stockOverlays);
  const outstanding = yield* tx
    .select()
    .from(commandOutbox)
    .where(inArray(commandOutbox.status, ["pending", "accepted_awaiting_integration"]))
    .all();
  const index = yield* loadStockIndex(tx);
  for (const row of Array.sort(outstanding, byClientSequence)) {
    const envelope = yield* parseStoredEnvelope(row);
    for (const overlay of decideOverlays(envelope, index.unitsPerPackFor, index.stockFor)) {
      yield* tx.insert(stockOverlays).values(overlay);
    }
  }
});

export const activateSnapshotGeneration = Effect.fn("ReplicaImport.activateSnapshotGeneration")(
  function* (tx: ReplicaDb, snapshotId: string) {
    const importRow = yield* tx
      .select()
      .from(snapshotImports)
      .where(eq(snapshotImports.snapshotId, snapshotId))
      .get();
    if (!importRow || importRow.stage !== "caught_up") {
      return yield* Effect.fail(
        syncProtocolError("SNAPSHOT_UNAVAILABLE", "The snapshot is not ready to activate."),
      );
    }
    const subscription = decodeSubscription(importRow.subscription);
    if (Option.isNone(subscription)) {
      return yield* Effect.fail(
        syncProtocolError("SCHEMA_VERSION_UNSUPPORTED", "The snapshot subscription is invalid."),
      );
    }
    const state = yield* loadReplicaState(tx);
    yield* promoteStagedSnapshot(tx, snapshotId, importDigestVersion(importRow.digestVersion));
    yield* integrateCoveredCommands(tx, importRow.horizon);
    yield* recomputePendingOverlays(tx);
    yield* reapplyPendingProjections(tx);
    yield* tx
      .update(replicaState)
      .set({
        activeGeneration: importRow.generation,
        appliedCommitSequence: importRow.horizon,
        localCommitVersion: state.localCommitVersion + 1,
      })
      .where(eq(replicaState.id, state.id));
    yield* tx
      .update(snapshotImports)
      .set({ stage: "activated" })
      .where(eq(snapshotImports.snapshotId, snapshotId));
    return {
      activeGeneration: importRow.generation,
      subscription: subscription.value,
    } satisfies SnapshotActivation;
  },
);
