import { performance } from "node:perf_hooks";
import { StatementSync, type SQLInputValue } from "node:sqlite";

import {
  SnapshotId,
  type PartitionDigestReport,
  type ReplicaInsightsWindow,
  type SnapshotManifest,
  type SnapshotPartPayload,
  type SyncCommand,
  type SyncPullResult,
  type SyncTransactionGroup,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Tracer from "effect/Tracer";

import {
  readReplicaInsights,
  readReplicaSubset,
  readReplicaSummary,
} from "../../client-db/src/replica/sql-client-session";
import type {
  InventorySubsetSpec,
  InventorySubsetSummarySpec,
} from "../../client-db/src/replica/subset-spec";
import { sqlitePartitionDigest } from "../src/replica/digest";
import { maintainReplicaPlanner } from "../src/replica/sqlite/planner";
import { ReplicaStore } from "../src/replica/store";
import {
  layerSqliteReplicaStore,
  runReplicaTransaction,
  SqliteReplica,
  type SqliteReplicaHandle,
} from "../src/sqlite";

export type SpanRecord = {
  readonly name: string;
  readonly millis: number;
  readonly query: string | undefined;
};

const SLOW_SPANS_KEPT = 25;

const isText = Schema.is(Schema.String);

const makeSpanLedger = () => {
  const maxByName = new Map<string, number>();
  const totalByName = new Map<string, number>();
  let slowest: Array<SpanRecord> = [];
  const record = (entry: SpanRecord) => {
    maxByName.set(entry.name, Math.max(maxByName.get(entry.name) ?? 0, entry.millis));
    totalByName.set(entry.name, (totalByName.get(entry.name) ?? 0) + entry.millis);
    if (slowest.length >= SLOW_SPANS_KEPT && (slowest.at(-1)?.millis ?? 0) >= entry.millis) return;
    slowest = [...slowest, entry]
      .sort((left, right) => right.millis - left.millis)
      .slice(0, SLOW_SPANS_KEPT);
  };
  class TimedSpan extends Tracer.NativeSpan {
    override end(endTime: bigint, exit: Parameters<Tracer.NativeSpan["end"]>[1]) {
      super.end(endTime, exit);
      const query = this.attributes.get("db.query.text");
      record({
        name: this.name,
        millis: Number(endTime - this.startTime) / 1e6,
        query: isText(query) ? query.slice(0, 160) : undefined,
      });
    }
  }
  return {
    tracer: Tracer.make({ span: (options) => new TimedSpan(options) }),
    reset: () => {
      maxByName.clear();
      totalByName.clear();
      slowest = [];
    },
    maxByName: (): ReadonlyMap<string, number> => new Map(maxByName),
    totalByName: (): ReadonlyMap<string, number> => new Map(totalByName),
    slowest: (): ReadonlyArray<SpanRecord> => slowest,
  };
};

export type SpanLedger = Omit<ReturnType<typeof makeSpanLedger>, "tracer">;

export type SqlTiming = { readonly sql: string; readonly millis: number };

const SLOW_CALLS_KEPT = 12;

const keepSlowest = (entries: ReadonlyArray<SqlTiming>, entry: SqlTiming) =>
  entries.length >= SLOW_CALLS_KEPT && (entries.at(-1)?.millis ?? 0) >= entry.millis
    ? entries
    : [...entries, entry]
        .sort((left, right) => right.millis - left.millis)
        .slice(0, SLOW_CALLS_KEPT);

type StatementOutcome =
  | ReturnType<StatementSync["all"]>
  | ReturnType<StatementSync["run"]>
  | ReturnType<StatementSync["get"]>;

const decodeOutcome = (outcome: StatementOutcome): StatementOutcome => outcome;

const makeSqlProbe = () => {
  let calls: ReadonlyArray<SqlTiming> = [];
  let holds: ReadonlyArray<SqlTiming> = [];
  let openedAt: number | undefined;
  let label: string | undefined;
  const observe = (sql: string, started: number, finished: number) => {
    calls = keepSlowest(calls, { sql: sql.slice(0, 140), millis: finished - started });
    const verb = sql.trimStart().slice(0, 6).toUpperCase();
    if (verb === "BEGIN ") {
      openedAt = started;
      label = undefined;
      return;
    }
    if (openedAt === undefined) return;
    if (verb === "COMMIT" || verb === "ROLLBA") {
      holds = keepSlowest(holds, { sql: label ?? "", millis: finished - openedAt });
      openedAt = undefined;
      return;
    }
    label ??= sql.slice(0, 140);
  };
  const timed = (name: "all" | "run" | "get") => {
    const original = Object.getOwnPropertyDescriptor(StatementSync.prototype, name)?.value;
    if (!Predicate.isFunction(original)) return;
    Object.defineProperty(StatementSync.prototype, name, {
      value: function (this: StatementSync, ...params: Array<SQLInputValue>): StatementOutcome {
        const started = performance.now();
        try {
          return decodeOutcome(original.apply(this, params));
        } finally {
          observe(this.sourceSQL, started, performance.now());
        }
      },
    });
  };
  timed("all");
  timed("run");
  timed("get");
  return {
    reset: () => {
      calls = [];
      holds = [];
    },
    slowCalls: () => calls,
    longestHolds: () => holds,
  };
};

export const sqlProbe = makeSqlProbe();

type EnqueueInput = {
  readonly operationId: string;
  readonly command: SyncCommand;
  readonly occurredAt: number;
};

export type BenchReplica = {
  readonly path: string;
  readonly readSubset: (
    spec: InventorySubsetSpec,
  ) => Promise<{ readonly rows: ReadonlyArray<unknown> }>;
  readonly summarizeSubset: (
    spec: InventorySubsetSummarySpec,
  ) => Promise<{ readonly count: number; readonly distinctValues: number }>;
  readonly readInsights: (window: ReplicaInsightsWindow) => Promise<{
    readonly rows: number;
    readonly truncated: boolean;
  }>;
  readonly enqueue: (input: EnqueueInput) => Promise<{ readonly status: string }>;
  readonly readAppliedCommitSequence: () => Promise<string>;
  readonly applyRemotePage: (page: SyncPullResult) => Promise<{
    readonly appliedThrough: string;
    readonly repairRequired: boolean;
    readonly digestVerified: boolean | undefined;
  }>;
  readonly applyTransactionGroup: (group: SyncTransactionGroup) => Promise<void>;
  readonly beginSnapshotImport: (manifest: SnapshotManifest) => Promise<void>;
  readonly importSnapshotPart: (
    manifest: SnapshotManifest,
    part: SnapshotPartPayload,
  ) => Promise<void>;
  readonly activateSnapshot: (manifest: SnapshotManifest) => Promise<void>;
  readonly claimNextUpload: (
    claimId: string,
    claimedAt: number,
  ) => Promise<{ readonly operationId: string } | undefined>;
  readonly releaseUploadClaim: (operationId: string, claimId: string) => Promise<void>;
  readonly execute: (statements: ReadonlyArray<string>) => Promise<void>;
  readonly standbyState: () => Promise<string | undefined>;
  readonly requestCleanup: () => Promise<void>;
  readonly computeDigest: () => Promise<{ readonly count: number } | undefined>;
  readonly digestReport: () => Promise<PartitionDigestReport | undefined>;
  readonly spans: SpanLedger;
  readonly optimizePlanner: () => Promise<string>;
  readonly close: () => Promise<void>;
};

export const openBenchReplica = async (path: string): Promise<BenchReplica> => {
  const token = "bench";
  const { tracer, ...spans } = makeSpanLedger();
  const runtime = ManagedRuntime.make(
    layerSqliteReplicaStore(token).pipe(
      Layer.provideMerge(SqliteReplica.layer(path)),
      Layer.provideMerge(Layer.succeed(Tracer.Tracer, tracer)),
    ),
  );
  const store = await runtime.runPromise(ReplicaStore.use(Effect.succeed));
  const withHandle = <A, E>(use: (handle: SqliteReplicaHandle) => Effect.Effect<A, E>) =>
    runtime.runPromise(SqliteReplica.use(use).pipe(Effect.orDie));
  const cursor = () => runtime.runPromise(store.readSyncCursor());
  let importScope = Scope.makeUnsafe();

  return {
    path,
    readSubset: async (spec) => {
      const read = await withHandle((handle) => readReplicaSubset(handle, token, spec));
      return { rows: read.rows };
    },
    summarizeSubset: async (spec) => {
      const read = await withHandle((handle) => readReplicaSummary(handle, token, spec));
      return {
        count: read.summary.count,
        distinctValues: read.summary.distinct.reduce((sum, entry) => sum + entry.values.length, 0),
      };
    },
    readInsights: async (window) => {
      const read = await withHandle((handle) => readReplicaInsights(handle, token, window));
      const facts = read.facts;
      return {
        rows:
          facts.products.length +
          facts.batches.length +
          facts.sales.length +
          facts.days.length +
          facts.hours.length,
        truncated: facts.truncated,
      };
    },
    enqueue: async ({ operationId, command, occurredAt }) => {
      const queued = await runtime.runPromise(
        store.enqueueCommand({ operationId, command, occurredAt }),
      );
      return { status: queued.value.status };
    },
    readAppliedCommitSequence: async () => (await cursor()).appliedCommitSequence,
    applyRemotePage: async (page) => {
      const applied = await runtime.runPromise(store.applyRemotePage(page));
      return {
        appliedThrough: applied.value.appliedThrough,
        repairRequired: applied.value.repairRequired,
        digestVerified: applied.value.digestVerified,
      };
    },
    applyTransactionGroup: async (group) => {
      await runtime.runPromise(store.applyTransactionGroup(group));
    },
    beginSnapshotImport: async (manifest) => {
      await runtime.runPromise(
        store.beginSnapshotImport(manifest).pipe(Scope.provide(importScope)),
      );
    },
    importSnapshotPart: async (manifest, part) => {
      await runtime.runPromise(store.importSnapshotPart(manifest, part));
    },
    activateSnapshot: async (manifest) => {
      await runtime.runPromise(
        store
          .activateSnapshot(manifest.snapshotId)
          .pipe(Effect.ensuring(Scope.close(importScope, Exit.void))),
      );
      importScope = Scope.makeUnsafe();
    },
    claimNextUpload: async (claimId, claimedAt) => {
      const claim = await runtime.runPromise(store.claimNextUpload({ claimId, claimedAt }));
      return claim.value;
    },
    releaseUploadClaim: async (operationId, claimId) => {
      await runtime.runPromise(store.releaseUploadClaim(operationId, claimId));
    },
    execute: (statements) =>
      withHandle((handle) =>
        handle.sql.withTransaction(
          Effect.forEach(statements, (statement) => handle.sql.unsafe(statement), {
            discard: true,
          }),
        ),
      ),
    standbyState: () =>
      withHandle((handle) =>
        handle.sql
          .unsafe<{ readonly standby: string }>("select standby from generation_state")
          .pipe(Effect.map((rows) => rows[0]?.standby)),
      ),
    requestCleanup: () =>
      runtime.runPromise(store.abandonSnapshot(SnapshotId.make("bench-cleanup-trigger"))),
    computeDigest: async () => {
      const report = await withHandle((handle) =>
        runReplicaTransaction(handle, (tx) => sqlitePartitionDigest(tx)),
      );
      return report ? { count: report.count } : undefined;
    },
    digestReport: () =>
      withHandle((handle) => runReplicaTransaction(handle, (tx) => sqlitePartitionDigest(tx))),
    spans,
    optimizePlanner: () =>
      withHandle((handle) => maintainReplicaPlanner(handle.sql, Number.POSITIVE_INFINITY)),
    close: () => runtime.dispose(),
  };
};
