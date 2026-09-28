import type { CommandOutcome, ReplicaSyncProgress } from "@store/client-db";
import type { CommandStatus } from "@store/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { extractLegacyChanges, type LegacyChanges } from "./extract";
import {
  LEGACY_DATABASE_PREFIX,
  LEGACY_MIGRATION_VERSION,
  legacyDatabaseName,
  legacySaleOutboxKey,
  type LegacyArchive,
  type LegacyDatabaseCapture,
  type LegacyMigrationReport,
  type LegacyMigrationState,
  type LegacyOperationRecord,
  type LegacyReportOperation,
} from "./model";
import {
  legacyOperationIds,
  legacySnapshotNeeds,
  planLegacyMigration,
  type LegacyIdentity,
  type LegacyPlanDecision,
  type LegacyReplicaSnapshot,
  type LegacySnapshotNeeds,
} from "./plan";

export class LegacyMigrationFailure extends Schema.TaggedError<LegacyMigrationFailure>()(
  "LegacyMigrationFailure",
  { step: Schema.String, message: Schema.String },
) {}

export const legacyMigrationFailure = (step: string) => (cause: unknown) =>
  new LegacyMigrationFailure({
    step,
    message: cause instanceof Error && cause.message ? cause.message : String(cause),
  });

type Port<A> = Effect.Effect<A, LegacyMigrationFailure>;

export type LegacyDatabaseProbe = {
  readonly pendingWrites: number;
  readonly invoiceRows: number;
};

export type LegacyStorePort = {
  readonly listDatabases: Port<ReadonlyArray<string>>;
  readonly readDatabase: (name: string) => Port<LegacyDatabaseCapture>;
  readonly probeDatabase: (name: string) => Port<LegacyDatabaseProbe>;
  readonly deleteDatabase: (name: string) => Port<void>;
  readonly readSaleOutbox: (key: string) => Port<string | null>;
  readonly removeSaleOutbox: (key: string) => Port<void>;
};

export type LegacyFilesPort = {
  readonly readState: (organizationId: string) => Port<LegacyMigrationState | null>;
  readonly writeState: (state: LegacyMigrationState) => Port<void>;
  readonly writeArchive: (archive: LegacyArchive) => Port<string>;
  readonly readArchive: (file: string) => Port<LegacyArchive>;
  readonly archiveExists: (file: string) => Port<boolean>;
  readonly writeReport: (report: LegacyMigrationReport) => Port<void>;
  readonly purgeDeadFiles: Port<ReadonlyArray<string>>;
};

export type LegacyEnqueueRequest = Extract<LegacyPlanDecision, { readonly _tag: "enqueue" }>;

export type LegacyReplicaPort = {
  readonly wakes: Stream.Stream<void>;
  readonly syncProgress: Port<ReplicaSyncProgress>;
  readonly readOutcomes: (
    operationIds: ReadonlyArray<string>,
  ) => Port<ReadonlyArray<CommandOutcome>>;
  readonly loadSnapshot: (needs: LegacySnapshotNeeds) => Port<LegacyReplicaSnapshot>;
  readonly enqueue: (request: LegacyEnqueueRequest) => Port<void>;
  readonly wakeUpload: Effect.Effect<void>;
};

export type LegacyMigrationPorts = {
  readonly identity: LegacyIdentity;
  readonly apiBaseUrl: string;
  readonly legacy: LegacyStorePort;
  readonly files: LegacyFilesPort;
  readonly replica: LegacyReplicaPort;
  readonly notify: (notice: {
    readonly carriedOver: number;
    readonly rejected: number;
  }) => Effect.Effect<void>;
  readonly report: (cause: unknown, op: string) => Effect.Effect<void>;
  readonly pollInterval?: number;
};

export type LegacyMigrationResult = "nothing" | "pending" | "blocked" | "purged";

const TERMINAL_STATUSES: ReadonlySet<CommandStatus> = new Set([
  "integrated",
  "accepted_awaiting_integration",
  "rejected",
  "abandoned",
]);

const DEFAULT_POLL_MILLIS = 30_000;

const wakeTicks = (ports: LegacyMigrationPorts) =>
  Stream.merge(ports.replica.wakes, Stream.tick(ports.pollInterval ?? DEFAULT_POLL_MILLIS));

const awaitCaughtUp = (ports: LegacyMigrationPorts) =>
  wakeTicks(ports).pipe(
    Stream.mapEffect(() => ports.replica.syncProgress),
    Stream.filter(
      (progress) => progress.caughtUpAt !== null && progress.caughtUpAt >= progress.sessionOpenedAt,
    ),
    Stream.runHead,
  );

const awaitTerminal = (ports: LegacyMigrationPorts, operationIds: ReadonlyArray<string>) =>
  operationIds.length === 0
    ? Effect.succeed<ReadonlyArray<CommandOutcome>>([])
    : wakeTicks(ports).pipe(
        Stream.mapEffect(() => ports.replica.readOutcomes(operationIds)),
        Stream.filter((outcomes) => {
          const terminal = new Set(
            outcomes
              .filter((outcome) => TERMINAL_STATUSES.has(outcome.status))
              .map((outcome) => outcome.operationId),
          );
          return operationIds.every((operationId) => terminal.has(operationId));
        }),
        Stream.runHead,
        Effect.map(Option.getOrElse((): ReadonlyArray<CommandOutcome> => [])),
      );

const record = (
  decision: LegacyPlanDecision,
  outcome: LegacyOperationRecord["outcome"],
  message: string | null,
): LegacyOperationRecord => ({
  operationId: decision.operationId,
  kind: decision.kind,
  outcome,
  reason: decision.reason,
  message,
  legacy: decision.legacy,
});

const enqueueDecision = (ports: LegacyMigrationPorts, decision: LegacyPlanDecision) => {
  switch (decision._tag) {
    case "queued":
      return Effect.succeed(record(decision, "queued", null));
    case "skipped":
      return Effect.succeed(record(decision, "skipped", decision.message));
    case "enqueue":
      return ports.replica.readOutcomes([decision.operationId]).pipe(
        Effect.flatMap((present) =>
          present.length > 0 ? Effect.void : ports.replica.enqueue(decision),
        ),
        Effect.retry({ times: 2, schedule: Schedule.spaced("250 millis") }),
        Effect.as(record(decision, "queued", null)),
        Effect.catch((failure) => Effect.succeed(record(decision, "failed", failure.message))),
      );
  }
};

const reportOperation = (
  operation: LegacyOperationRecord,
  outcomes: ReadonlyMap<string, CommandOutcome>,
): LegacyReportOperation => {
  const base = {
    operationId: operation.operationId,
    kind: operation.kind,
    reason: operation.reason,
    legacy: operation.legacy,
  };
  if (operation.outcome === "skipped") {
    return { ...base, outcome: "skipped", code: null, message: operation.message };
  }
  if (operation.outcome === "failed") {
    return { ...base, outcome: "notQueued", code: null, message: operation.message };
  }
  const outcome = outcomes.get(operation.operationId);
  switch (outcome?.status) {
    case "integrated":
    case "accepted_awaiting_integration":
      return { ...base, outcome: "accepted", code: null, message: null };
    case "rejected":
      return {
        ...base,
        outcome: "rejected",
        code: outcome.rejection?.code ?? null,
        message: outcome.rejection?.message ?? null,
      };
    case "abandoned":
      return { ...base, outcome: "abandoned", code: "COMMAND_ABANDONED", message: null };
    default:
      return { ...base, outcome: "pending", code: null, message: null };
  }
};

export const buildLegacyReport = (
  state: LegacyMigrationState,
  changes: LegacyChanges,
  outcomes: ReadonlyArray<CommandOutcome>,
  complete: boolean,
  generatedAt: number,
): LegacyMigrationReport => {
  const byId = new Map(outcomes.map((outcome) => [outcome.operationId, outcome]));
  const operations = state.operations.map((operation) => reportOperation(operation, byId));
  const count = (...kinds: ReadonlyArray<LegacyReportOperation["outcome"]>) =>
    operations.filter((operation) => kinds.includes(operation.outcome)).length;
  return {
    version: LEGACY_MIGRATION_VERSION,
    organizationId: state.organizationId,
    generatedAt,
    complete,
    archiveFile: state.archiveFile,
    counts: {
      carriedOver: count("accepted"),
      accepted: count("accepted"),
      rejected: count("rejected", "abandoned"),
      skipped: count("skipped"),
      notQueued: count("notQueued"),
      undecodable: changes.undecodable.length,
    },
    operations,
    undecodable: changes.undecodable,
  };
};

const sweepOtherDatabases = (ports: LegacyMigrationPorts, databases: ReadonlyArray<string>) => {
  const own = legacyDatabaseName(ports.apiBaseUrl, ports.identity.organizationId);
  return Effect.forEach(
    databases.filter((name) => name.startsWith(LEGACY_DATABASE_PREFIX) && name !== own),
    (name) =>
      ports.legacy.probeDatabase(name).pipe(
        Effect.flatMap((probe) =>
          probe.pendingWrites === 0 && probe.invoiceRows === 0
            ? ports.legacy.deleteDatabase(name)
            : Effect.void,
        ),
        Effect.catch((failure) => ports.report(failure, "legacy-migration-sweep")),
      ),
    { discard: true },
  );
};

const captureLegacy = Effect.fn("LegacyMigration.capture")(function* (
  ports: LegacyMigrationPorts,
  sources: {
    readonly databaseName: string | null;
    readonly saleOutboxKey: string;
    readonly saleOutbox: string | null;
  },
) {
  const databases =
    sources.databaseName === null ? [] : [yield* ports.legacy.readDatabase(sources.databaseName)];
  const archive: LegacyArchive = {
    version: LEGACY_MIGRATION_VERSION,
    organizationId: ports.identity.organizationId,
    apiBaseUrl: ports.apiBaseUrl,
    capturedAt: yield* Clock.currentTimeMillis,
    databases,
    saleOutbox:
      sources.saleOutbox === null
        ? []
        : [{ key: sources.saleOutboxKey, value: sources.saleOutbox }],
  };
  return archive;
});

const keepEarlierReason =
  (earlier: ReadonlyArray<LegacyOperationRecord>) =>
  (operation: LegacyOperationRecord): LegacyOperationRecord => {
    const previous = earlier.find(
      (candidate) =>
        candidate.operationId === operation.operationId && candidate.outcome === "queued",
    );
    return operation.reason === "alreadyQueued" && previous !== undefined
      ? { ...operation, reason: previous.reason }
      : operation;
  };

const planAndEnqueue = Effect.fn("LegacyMigration.planAndEnqueue")(function* (
  ports: LegacyMigrationPorts,
  changes: LegacyChanges,
  earlier: ReadonlyArray<LegacyOperationRecord>,
) {
  yield* awaitCaughtUp(ports);
  const present = yield* ports.replica.readOutcomes(legacyOperationIds(ports.identity, changes));
  const snapshot = yield* ports.replica.loadSnapshot(legacySnapshotNeeds(changes));
  const decisions = planLegacyMigration({
    identity: ports.identity,
    changes,
    replica: snapshot,
    queued: new Set(present.map((outcome) => outcome.operationId)),
    now: yield* Clock.currentTimeMillis,
  });
  const records = yield* Effect.forEach(decisions, (decision) => enqueueDecision(ports, decision));
  yield* ports.replica.wakeUpload;
  return records.map(keepEarlierReason(earlier));
});

export const runLegacyMigration = Effect.fn("LegacyMigration.run")(function* (
  ports: LegacyMigrationPorts,
) {
  const { organizationId } = ports.identity;
  const databaseName = legacyDatabaseName(ports.apiBaseUrl, organizationId);
  const saleOutboxKey = legacySaleOutboxKey(organizationId);
  const stored = yield* ports.files.readState(organizationId);
  if (stored?.phase === "purged") return "purged" satisfies LegacyMigrationResult;

  const databases = yield* ports.legacy.listDatabases;

  const hasDatabase = databases.includes(databaseName);
  const saleOutbox = yield* ports.legacy.readSaleOutbox(saleOutboxKey);
  const live = hasDatabase || saleOutbox !== null;

  if (stored === null && !live) {
    yield* ports.files.purgeDeadFiles;
    yield* sweepOtherDatabases(ports, databases);
    return "nothing" satisfies LegacyMigrationResult;
  }

  const sources = { databaseName: hasDatabase ? databaseName : null, saleOutboxKey, saleOutbox };
  const archived = stored !== null && (yield* ports.files.archiveExists(stored.archiveFile));
  let state: LegacyMigrationState;
  let archive: LegacyArchive;
  if (stored !== null && archived) {
    state = stored;
    archive = live
      ? yield* captureLegacy(ports, sources)
      : yield* ports.files.readArchive(stored.archiveFile);
  } else {
    if (!live) {
      return yield* new LegacyMigrationFailure({
        step: "archive",
        message: "The legacy archive is missing and the legacy stores are gone.",
      });
    }
    archive = yield* captureLegacy(ports, sources);
    const archiveFile = yield* ports.files.writeArchive(archive);
    state = {
      version: LEGACY_MIGRATION_VERSION,
      organizationId,
      phase: stored?.phase ?? "archived",
      archiveFile,
      databases: hasDatabase ? [databaseName] : [],
      saleOutboxKeys: saleOutbox === null ? [] : [saleOutboxKey],
      runs: stored?.runs ?? 0,
      operations: stored?.operations ?? [],
      notice: stored?.notice ?? null,
      notified: stored?.notified ?? false,
      updatedAt: archive.capturedAt,
    };
    yield* ports.files.writeState(state);
  }

  const changes = extractLegacyChanges(archive);
  if (changes.undecodable.length > 0) {
    yield* ports.report(
      new Error(`${changes.undecodable.length} legacy entries could not be decoded.`),
      "legacy-migration-undecodable",
    );
  }

  if (state.phase === "archived" || state.phase === "enqueued") {
    const operations = yield* planAndEnqueue(ports, changes, state.operations);
    state = {
      ...state,
      phase: "enqueued",
      runs: state.runs + 1,
      operations,
      updatedAt: yield* Clock.currentTimeMillis,
    };
    yield* ports.files.writeState(state);
    const failed = operations.filter((operation) => operation.outcome === "failed");
    if (failed.length > 0) {
      yield* ports.files.writeReport(
        buildLegacyReport(state, changes, [], false, yield* Clock.currentTimeMillis),
      );
      yield* ports.report(
        new Error(`${failed.length} legacy changes could not be queued.`),
        "legacy-migration-enqueue",
      );
      return "pending" satisfies LegacyMigrationResult;
    }
    const tracked = operations
      .filter((operation) => operation.outcome === "queued")
      .map((operation) => operation.operationId);
    const outcomes = yield* awaitTerminal(ports, tracked);
    const report = buildLegacyReport(
      state,
      changes,
      outcomes,
      true,
      yield* Clock.currentTimeMillis,
    );
    yield* ports.files.writeReport(report);
    state = {
      ...state,
      phase: "reported",
      notice: { carriedOver: report.counts.carriedOver, rejected: report.counts.rejected },
      updatedAt: report.generatedAt,
    };
    yield* ports.files.writeState(state);
  }

  if (!state.notified && state.notice !== null) {
    if (state.notice.carriedOver + state.notice.rejected > 0) yield* ports.notify(state.notice);
    state = { ...state, notified: true };
    yield* ports.files.writeState(state);
  }

  if (changes.undecodable.length > 0) return "blocked" satisfies LegacyMigrationResult;
  if (!(yield* ports.files.archiveExists(state.archiveFile))) {
    return yield* new LegacyMigrationFailure({
      step: "purge",
      message: "The legacy archive is missing, so the legacy stores were kept.",
    });
  }
  for (const database of state.databases) {
    if (databases.includes(database)) yield* ports.legacy.deleteDatabase(database);
  }
  for (const key of state.saleOutboxKeys) yield* ports.legacy.removeSaleOutbox(key);
  yield* ports.files.purgeDeadFiles;
  state = { ...state, phase: "purged", updatedAt: yield* Clock.currentTimeMillis };
  yield* ports.files.writeState(state);
  yield* sweepOtherDatabases(ports, databases);
  return "purged" satisfies LegacyMigrationResult;
});
