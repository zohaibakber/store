import {
  compareDecimalSequence,
  syncProtocolError,
  type SnapshotManifest,
  type SnapshotPartPayload,
  type SyncPullResult,
  type SyncSubscription,
} from "@store/contracts";
import {
  commandOutbox,
  generationJournal,
  generationState,
  replicaState,
  snapshotImports,
  stockOverlays,
} from "@store/db/replica.schema";
import { and, asc, eq, getTableColumns, gt, inArray, lte, ne, notInArray, sql } from "drizzle-orm";
import * as Array from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { admitAuthority } from "./admission-authority";
import { applyGroupRows } from "./apply";
import { decodeEntity, decodeStoredEnvelope, decodeSubscription } from "./codecs";
import { loadReplicaState } from "./commands";
import { recordSnapshotCoverage } from "./coverage";
import {
  byEntityDependency,
  decideOverlays,
  decidePartAdmission,
  OUTSTANDING_COMMAND_STATUSES,
} from "./decisions";
import { hasSqlReason } from "./errors";
import { loadCommandContext } from "./footprint";
import { readUnitsPerPack, sqliteCatalogReads } from "./lookup";
import { restorePendingProjection, writePendingProjection } from "./pending";
import type { ReplicaDb } from "./sql-client/drizzle";
import {
  clearRetiredStep,
  decodeGroupJson,
  journalHead,
  loadGenerationState,
  swapGenerationRoles,
  swapSearchIndexes,
  IMPORT_TURN_MILLIS,
  withStandbyActive,
} from "./sqlite/generation";
import { sqlitePendingRows } from "./sqlite/pending-rows";
import { upsertSnapshotRows } from "./sqlite/snapshot-rows";

type ImportRow = typeof snapshotImports.$inferSelect;

type OutboxRow = typeof commandOutbox.$inferSelect;

type JournalRow = typeof generationJournal.$inferSelect;

type SnapshotImportStage =
  | { readonly _tag: "importing"; readonly partsImported: number; readonly partsTotal: number }
  | { readonly _tag: "caught_up"; readonly throughCommitSequence: string }
  | { readonly _tag: "activated" };

export type SnapshotStep =
  | { readonly _tag: "progressed" }
  | {
      readonly _tag: "needsAuthority";
      readonly afterCommitSequence: string;
      readonly throughCommitSequence: string;
    }
  | {
      readonly _tag: "activated";
      readonly activeGeneration: number;
      readonly subscription: SyncSubscription;
    };

const JOURNAL_REPLAY_ENTRIES = 50;

const FINAL_TURN_ENTRIES = 8;

const REBUILD_COMMANDS = 25;

const ACTIVATION_WORK_MILLIS = 40;

const unavailable = (message: string) => syncProtocolError("SNAPSHOT_UNAVAILABLE", message);

const stageOf = (row: {
  readonly stage: string;
  readonly horizon: string;
  readonly partsImported: number;
  readonly partsTotal: number;
}): SnapshotImportStage => {
  if (row.stage === "activated") return { _tag: "activated" };
  if (row.stage === "importing") {
    return { _tag: "importing", partsImported: row.partsImported, partsTotal: row.partsTotal };
  }
  return { _tag: "caught_up", throughCommitSequence: row.horizon };
};

const loadImport = (tx: ReplicaDb, snapshotId: string) =>
  tx.select().from(snapshotImports).where(eq(snapshotImports.snapshotId, snapshotId)).get();

const finishedImportStages = ["activated", "failed"] as const;

export const abandonSnapshotCandidate = Effect.fn("ReplicaImport.abandonSnapshotCandidate")(
  function* (tx: ReplicaDb, snapshotId: string) {
    const importRow = yield* loadImport(tx, snapshotId);
    if (!importRow || importRow.stage === "activated" || importRow.stage === "failed") return;
    yield* tx
      .update(snapshotImports)
      .set({ stage: "failed" })
      .where(eq(snapshotImports.snapshotId, snapshotId));
    const state = yield* loadGenerationState(tx);
    if (state.candidateSnapshotId === snapshotId) {
      yield* tx
        .update(generationState)
        .set({ standby: "retired", candidateSnapshotId: null })
        .where(eq(generationState.id, state.id));
    }
  },
);

const abandonOtherCandidates = Effect.fn("ReplicaImport.abandonOtherCandidates")(function* (
  tx: ReplicaDb,
  keepSnapshotId: string,
) {
  const stale = yield* tx
    .select({ snapshotId: snapshotImports.snapshotId })
    .from(snapshotImports)
    .where(
      and(
        notInArray(snapshotImports.stage, [...finishedImportStages]),
        ne(snapshotImports.snapshotId, keepSnapshotId),
      ),
    )
    .all();
  for (const row of stale) yield* abandonSnapshotCandidate(tx, row.snapshotId);
});

const isFinishedImport = (row: ImportRow | undefined): boolean =>
  row === undefined || row.stage === "activated" || row.stage === "failed";

const retireOrphanCandidate = Effect.fn("ReplicaImport.retireOrphanCandidate")(function* (
  tx: ReplicaDb,
) {
  const generation = yield* loadGenerationState(tx);
  if (generation.standby !== "candidate") return;
  const candidate =
    generation.candidateSnapshotId === null
      ? undefined
      : yield* loadImport(tx, generation.candidateSnapshotId);
  if (!isFinishedImport(candidate)) return;
  yield* tx
    .update(generationState)
    .set({ standby: "retired", candidateSnapshotId: null })
    .where(eq(generationState.id, generation.id));
});

export const prepareSnapshotImport = Effect.fn("ReplicaImport.prepareSnapshotImport")(function* (
  tx: ReplicaDb,
  snapshotId: string,
) {
  const existing = yield* loadImport(tx, snapshotId);
  if (existing?.stage === "failed") {
    yield* tx.delete(snapshotImports).where(eq(snapshotImports.snapshotId, snapshotId));
  }
  yield* abandonOtherCandidates(tx, snapshotId);
  yield* retireOrphanCandidate(tx);
});

export const beginSnapshotImport = Effect.fn("ReplicaImport.beginSnapshotImport")(function* (
  tx: ReplicaDb,
  manifest: SnapshotManifest,
) {
  yield* prepareSnapshotImport(tx, manifest.snapshotId);
  const existing = yield* loadImport(tx, manifest.snapshotId);
  if (existing) return stageOf(existing);
  yield* Effect.repeat(clearRetiredStep(tx), { until: (step) => !step.remaining });
  const state = yield* loadReplicaState(tx);
  const generation = yield* loadGenerationState(tx);
  if (generation.standby !== "empty") {
    return yield* Effect.fail(unavailable("The standby generation is not empty."));
  }
  const stage = manifest.parts.length === 0 ? "caught_up" : "importing";
  yield* tx.insert(snapshotImports).values({
    snapshotId: manifest.snapshotId,
    generation: state.activeGeneration + 1,
    subscription: manifest.subscription,
    horizon: manifest.horizon,
    stage,
    partsImported: 0,
    partsTotal: manifest.parts.length,
    candidateThrough: manifest.horizon,
    requiredThrough: state.appliedCommitSequence,
    journalCursor: yield* journalHead(tx),
  });
  yield* tx
    .update(generationState)
    .set({ standby: "candidate", candidateSnapshotId: manifest.snapshotId })
    .where(eq(generationState.id, generation.id));
  return stageOf({
    stage,
    horizon: manifest.horizon,
    partsImported: 0,
    partsTotal: manifest.parts.length,
  });
});

const importPartRows = Effect.fn("ReplicaImport.importPartRows")(function* (
  tx: ReplicaDb,
  rows: SnapshotPartPayload["rows"],
) {
  const grouped = Array.groupBy(rows, (row) => row.entity);
  const entities = Array.sort(
    Object.keys(grouped).map((key) => ({ entity: decodeEntity(key) })),
    byEntityDependency,
  );
  for (const { entity } of entities) {
    yield* upsertSnapshotRows(
      tx,
      entity,
      (grouped[entity] ?? []).map((row) => row.row),
    );
  }
});

const admitPart = (tx: ReplicaDb, manifest: SnapshotManifest, part: SnapshotPartPayload) =>
  loadImport(tx, manifest.snapshotId).pipe(
    Effect.flatMap((importRow) =>
      Effect.fromResult(decidePartAdmission(importRow, manifest, part)),
    ),
  );

const importAdmittedRows = (tx: ReplicaDb, rows: SnapshotPartPayload["rows"]) =>
  importPartRows(tx, rows).pipe(
    Effect.mapError((error) =>
      hasSqlReason(error, ["ConstraintError", "UniqueViolation"])
        ? unavailable("The snapshot part violates the replica schema.")
        : error,
    ),
  );

const completePart = Effect.fn("ReplicaImport.completePart")(function* (
  tx: ReplicaDb,
  manifest: SnapshotManifest,
  importRow: ImportRow,
) {
  const partsImported = importRow.partsImported + 1;
  const stage = partsImported === importRow.partsTotal ? "caught_up" : "importing";
  yield* tx
    .update(snapshotImports)
    .set({ partsImported, stage })
    .where(eq(snapshotImports.snapshotId, manifest.snapshotId));
  return stageOf({ ...importRow, partsImported, stage });
});

export const importSnapshotPart = Effect.fn("ReplicaImport.importSnapshotPart")(function* (
  tx: ReplicaDb,
  manifest: SnapshotManifest,
  part: SnapshotPartPayload,
) {
  const admission = yield* admitPart(tx, manifest, part);
  if (admission._tag === "imported") return stageOf(admission.importRow);
  yield* importAdmittedRows(tx, part.rows);
  return yield* completePart(tx, manifest, admission.importRow);
});

type ImportedRows = {
  readonly partsCompleted: number;
  readonly rowOffset: number;
};

export const importSnapshotRows = Effect.fn("ReplicaImport.importSnapshotRows")(function* (
  tx: ReplicaDb,
  manifest: SnapshotManifest,
  parts: ReadonlyArray<SnapshotPartPayload>,
  rowOffset: number,
  rowBudget: number,
  budgetMillis: number = IMPORT_TURN_MILLIS,
) {
  const started = yield* Clock.currentTimeMillis;
  let partsCompleted = 0;
  let offset = rowOffset;
  let rowsLeft = rowBudget;
  for (const part of parts) {
    const admission = yield* admitPart(tx, manifest, part);
    if (admission._tag === "next") {
      const rows = part.rows.slice(offset, offset + rowsLeft);
      yield* importAdmittedRows(tx, rows);
      offset += rows.length;
      rowsLeft -= rows.length;
      if (offset < part.rows.length) {
        return { partsCompleted, rowOffset: offset } satisfies ImportedRows;
      }
      yield* completePart(tx, manifest, admission.importRow);
    }
    partsCompleted += 1;
    offset = 0;
    if (rowsLeft <= 0 || (yield* Clock.currentTimeMillis) - started >= budgetMillis) break;
  }
  return { partsCompleted, rowOffset: 0 } satisfies ImportedRows;
});

const readJournal = (tx: ReplicaDb, after: number, limit: number) =>
  tx
    .select()
    .from(generationJournal)
    .where(gt(generationJournal.seq, after))
    .orderBy(asc(generationJournal.seq))
    .limit(limit)
    .all();

const isOutstanding = (row: OutboxRow): boolean =>
  OUTSTANDING_COMMAND_STATUSES.includes(row.status);

const isCoveredBy = (row: OutboxRow, through: string): boolean =>
  row.status === "accepted_awaiting_integration" &&
  row.commitSequence !== null &&
  compareDecimalSequence(row.commitSequence, through) <= 0;

const coveredOutbox = (tx: ReplicaDb, through: string) =>
  tx
    .select()
    .from(commandOutbox)
    .where(eq(commandOutbox.status, "accepted_awaiting_integration"))
    .all()
    .pipe(Effect.map((rows) => rows.filter((row) => isCoveredBy(row, through))));

type StateRow = typeof replicaState.$inferSelect;

type ProjectionState = Pick<StateRow, "organizationId" | "userId">;

const projectOutstandingCommand = Effect.fn("ReplicaImport.projectOutstandingCommand")(function* (
  tx: ReplicaDb,
  state: ProjectionState,
  row: OutboxRow,
) {
  const envelope = yield* decodeStoredEnvelope(row);
  const unitsPerPackFor = yield* readUnitsPerPack(
    tx,
    state.organizationId,
    envelope.command._tag === "issueInvoice"
      ? envelope.command.payload.allocations.map((take) => take.productId)
      : [],
  );
  for (const overlay of decideOverlays(envelope, unitsPerPackFor)) {
    yield* tx.insert(stockOverlays).values(overlay).onConflictDoNothing();
  }
  const { lookup } = yield* loadCommandContext(
    envelope.command,
    sqliteCatalogReads(tx, state.organizationId),
    { checkRules: false, withStock: false },
  );
  yield* writePendingProjection(
    sqlitePendingRows(tx, state.organizationId),
    envelope,
    state,
    lookup,
    true,
  );
});

const discardCommandProjection = Effect.fn("ReplicaImport.discardCommandProjection")(function* (
  tx: ReplicaDb,
  state: ProjectionState,
  operationId: string,
) {
  yield* tx.delete(stockOverlays).where(eq(stockOverlays.commandId, operationId));
  yield* restorePendingProjection(sqlitePendingRows(tx, state.organizationId), operationId);
});

type JournalReplay = {
  readonly through: string;
  readonly consumed: number;
};

const replayEntry = Effect.fn("ReplicaImport.replayEntry")(function* (
  tx: ReplicaDb,
  state: ProjectionState,
  entry: JournalRow,
  through: string,
  mode: "base" | "full",
) {
  if (entry.kind === "group") {
    const group = yield* decodeGroupJson(entry.payloadJson ?? "").pipe(
      Effect.mapError(() => unavailable("The replay journal entry is unreadable.")),
    );
    if (compareDecimalSequence(group.commitSequence, through) > 0) {
      yield* applyGroupRows(tx, state.organizationId, group);
      return group.commitSequence;
    }
    if (mode === "full") yield* discardCommandProjection(tx, state, group.operationId);
    return through;
  }
  if (mode === "base") return through;
  if (entry.kind === "reject") {
    yield* discardCommandProjection(tx, state, entry.operationId);
    return through;
  }
  const row = yield* tx
    .select()
    .from(commandOutbox)
    .where(eq(commandOutbox.operationId, entry.operationId))
    .get();
  if (row && isOutstanding(row) && !isCoveredBy(row, through)) {
    yield* projectOutstandingCommand(tx, state, row);
  }
  return through;
});

const replayJournal = Effect.fn("ReplicaImport.replayJournal")(function* (
  tx: ReplicaDb,
  state: ProjectionState,
  entries: ReadonlyArray<JournalRow>,
  through: string,
  mode: "base" | "full",
  budgetMillis: number = Number.POSITIVE_INFINITY,
) {
  const deadline = (yield* Clock.currentTimeMillis) + budgetMillis;
  let candidateThrough = through;
  let consumed = 0;
  for (const entry of entries) {
    candidateThrough = yield* replayEntry(tx, state, entry, candidateThrough, mode);
    consumed += 1;
    if ((yield* Clock.currentTimeMillis) >= deadline) break;
  }
  return { through: candidateThrough, consumed } satisfies JournalReplay;
});

const settleCoveredProjections = Effect.fn("ReplicaImport.settleCoveredProjections")(function* (
  tx: ReplicaDb,
  state: ProjectionState,
  through: string,
) {
  for (const row of yield* coveredOutbox(tx, through)) {
    yield* discardCommandProjection(tx, state, row.operationId);
  }
});

const catchUpStep = Effect.fn("ReplicaImport.catchUpStep")(function* (
  tx: ReplicaDb,
  importRow: ImportRow,
  state: ProjectionState,
) {
  if (compareDecimalSequence(importRow.candidateThrough, importRow.requiredThrough) < 0) {
    return {
      _tag: "needsAuthority",
      afterCommitSequence: importRow.candidateThrough,
      throughCommitSequence: importRow.requiredThrough,
    } satisfies SnapshotStep;
  }
  const entries = yield* readJournal(tx, importRow.journalCursor, JOURNAL_REPLAY_ENTRIES);
  const replayed = entries.some((entry) => entry.kind === "group")
    ? yield* withStandbyActive(
        tx,
        replayJournal(
          tx,
          state,
          entries,
          importRow.candidateThrough,
          "base",
          ACTIVATION_WORK_MILLIS,
        ),
      )
    : { through: importRow.candidateThrough, consumed: entries.length };
  const candidateThrough = replayed.through;
  const journalCursor = entries[replayed.consumed - 1]?.seq ?? importRow.journalCursor;
  const drained = replayed.consumed === entries.length && entries.length < JOURNAL_REPLAY_ENTRIES;
  const boundary = drained
    ? yield* tx
        .select({ rowid: sql<number | null>`max(rowid)` })
        .from(commandOutbox)
        .get()
    : undefined;
  yield* tx
    .update(snapshotImports)
    .set({
      candidateThrough,
      journalCursor,
      stage: drained ? "rebuilding" : undefined,
      rebuildBoundary: drained ? (boundary?.rowid ?? 0) : undefined,
      rebuildCursor: drained ? 0 : undefined,
    })
    .where(eq(snapshotImports.snapshotId, importRow.snapshotId));
  return { _tag: "progressed" } satisfies SnapshotStep;
});

const projectOutstandingPage = Effect.fn("ReplicaImport.projectOutstandingPage")(function* (
  tx: ReplicaDb,
  state: ProjectionState,
  page: ReadonlyArray<OutboxRow>,
  candidateThrough: string,
) {
  const deadline = (yield* Clock.currentTimeMillis) + ACTIVATION_WORK_MILLIS;
  let processed = 0;
  for (const row of page) {
    processed += 1;
    if (isCoveredBy(row, candidateThrough)) continue;
    yield* projectOutstandingCommand(tx, state, row);
    if ((yield* Clock.currentTimeMillis) >= deadline) break;
  }
  return processed;
});

const rebuildStep = Effect.fn("ReplicaImport.rebuildStep")(function* (
  tx: ReplicaDb,
  importRow: ImportRow,
  state: ProjectionState,
) {
  const boundary = importRow.rebuildBoundary ?? 0;
  const page = yield* tx
    .select({ ...getTableColumns(commandOutbox), rowid: sql<number>`rowid` })
    .from(commandOutbox)
    .where(
      and(
        sql`rowid > ${importRow.rebuildCursor}`,
        lte(sql`rowid`, boundary),
        inArray(commandOutbox.status, [...OUTSTANDING_COMMAND_STATUSES]),
      ),
    )
    .orderBy(sql`rowid`)
    .limit(REBUILD_COMMANDS)
    .all();
  const projected = page.some((row) => !isCoveredBy(row, importRow.candidateThrough))
    ? yield* withStandbyActive(
        tx,
        projectOutstandingPage(tx, state, page, importRow.candidateThrough),
      )
    : page.length;
  const last = page[projected - 1];
  const finished = projected === page.length && page.length < REBUILD_COMMANDS;
  yield* tx
    .update(snapshotImports)
    .set({
      rebuildCursor: last?.rowid ?? boundary,
      stage: finished ? "replaying" : undefined,
    })
    .where(eq(snapshotImports.snapshotId, importRow.snapshotId));
  return { _tag: "progressed" } satisfies SnapshotStep;
});

const integrateCoveredCommands = Effect.fn("ReplicaImport.integrateCoveredCommands")(function* (
  tx: ReplicaDb,
  through: string,
) {
  for (const row of yield* coveredOutbox(tx, through)) {
    yield* tx
      .update(commandOutbox)
      .set({ status: "integrated" })
      .where(eq(commandOutbox.operationId, row.operationId));
  }
});

const replayStep = Effect.fn("ReplicaImport.replayStep")(function* (
  tx: ReplicaDb,
  importRow: ImportRow,
  state: StateRow,
  subscription: SyncSubscription,
) {
  const entries = yield* readJournal(tx, importRow.journalCursor, FINAL_TURN_ENTRIES + 1);
  if (entries.length > FINAL_TURN_ENTRIES) {
    const batch = yield* readJournal(tx, importRow.journalCursor, JOURNAL_REPLAY_ENTRIES);
    const replayed = yield* withStandbyActive(
      tx,
      Effect.gen(function* () {
        const replay = yield* replayJournal(
          tx,
          state,
          batch,
          importRow.candidateThrough,
          "full",
          ACTIVATION_WORK_MILLIS,
        );
        yield* settleCoveredProjections(tx, state, replay.through);
        return replay;
      }),
    );
    yield* tx
      .update(snapshotImports)
      .set({
        candidateThrough: replayed.through,
        journalCursor: batch[replayed.consumed - 1]?.seq ?? importRow.journalCursor,
      })
      .where(eq(snapshotImports.snapshotId, importRow.snapshotId));
    return { _tag: "progressed" } satisfies SnapshotStep;
  }
  yield* swapGenerationRoles(tx);
  const candidateThrough = yield* replayJournal(
    tx,
    state,
    entries,
    importRow.candidateThrough,
    "full",
  ).pipe(
    Effect.map((replay) => replay.through),
    Effect.tap((through) => settleCoveredProjections(tx, state, through)),
  );
  const journalCursor = entries.at(-1)?.seq ?? importRow.journalCursor;
  if (compareDecimalSequence(candidateThrough, state.appliedCommitSequence) < 0) {
    yield* swapGenerationRoles(tx);
    yield* tx
      .update(snapshotImports)
      .set({ candidateThrough, journalCursor })
      .where(eq(snapshotImports.snapshotId, importRow.snapshotId));
    return {
      _tag: "needsAuthority",
      afterCommitSequence: candidateThrough,
      throughCommitSequence: state.appliedCommitSequence,
    } satisfies SnapshotStep;
  }
  yield* swapSearchIndexes(tx);
  yield* integrateCoveredCommands(tx, candidateThrough);
  yield* recordSnapshotCoverage(tx, subscription, candidateThrough);
  yield* tx
    .update(replicaState)
    .set({
      activeGeneration: importRow.generation,
      appliedCommitSequence: candidateThrough,
      localCommitVersion: state.localCommitVersion + 1,
    })
    .where(eq(replicaState.id, state.id));
  yield* tx
    .update(snapshotImports)
    .set({ stage: "activated", candidateThrough, journalCursor })
    .where(eq(snapshotImports.snapshotId, importRow.snapshotId));
  yield* tx
    .update(generationState)
    .set({ standby: "retired", candidateSnapshotId: null, statsStale: true })
    .where(eq(generationState.candidateSnapshotId, importRow.snapshotId));
  return {
    _tag: "activated",
    activeGeneration: importRow.generation,
    subscription,
  } satisfies SnapshotStep;
});

export const stepSnapshotActivation = Effect.fn("ReplicaImport.stepSnapshotActivation")(function* (
  tx: ReplicaDb,
  snapshotId: string,
) {
  const importRow = yield* loadImport(tx, snapshotId);
  if (!importRow || importRow.stage === "failed" || importRow.stage === "importing") {
    return yield* Effect.fail(unavailable("The snapshot is not ready to activate."));
  }
  const subscription = decodeSubscription(importRow.subscription);
  if (Option.isNone(subscription)) {
    return yield* Effect.fail(
      syncProtocolError("SCHEMA_VERSION_UNSUPPORTED", "The snapshot subscription is invalid."),
    );
  }
  if (importRow.stage === "activated") {
    return {
      _tag: "activated",
      activeGeneration: importRow.generation,
      subscription: subscription.value,
    } satisfies SnapshotStep;
  }
  const state = yield* loadReplicaState(tx);
  switch (importRow.stage) {
    case "caught_up":
      return yield* catchUpStep(tx, importRow, state);
    case "rebuilding":
      return yield* rebuildStep(tx, importRow, state);
    default:
      return yield* replayStep(tx, importRow, state, subscription.value);
  }
});

export const applyCandidateAuthority = Effect.fn("ReplicaImport.applyCandidateAuthority")(
  function* (tx: ReplicaDb, snapshotId: string, page: SyncPullResult) {
    const importRow = yield* loadImport(tx, snapshotId);
    if (!importRow || importRow.stage !== "caught_up") {
      return yield* Effect.fail(unavailable("The snapshot candidate is not catching up."));
    }
    const state = yield* loadReplicaState(tx);
    const admission = admitAuthority(
      {
        epoch: state.epoch,
        incarnation: state.incarnation,
        appliedCommitSequence: importRow.candidateThrough,
      },
      { _tag: "candidatePage", page },
    );
    if (admission._tag === "refuse") return yield* admission.error;
    if (admission._tag !== "apply") return importRow.candidateThrough;
    yield* withStandbyActive(
      tx,
      Effect.forEach(admission.groups, (group) => applyGroupRows(tx, state.organizationId, group), {
        discard: true,
      }),
    );
    yield* tx
      .update(snapshotImports)
      .set({ candidateThrough: admission.through })
      .where(eq(snapshotImports.snapshotId, snapshotId));
    return admission.through;
  },
);
