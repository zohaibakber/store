import * as IndexedDb from "@effect/platform-browser/IndexedDb";
import * as IndexedDbDatabase from "@effect/platform-browser/IndexedDbDatabase";
import {
  incrementDecimalSequence,
  syncProtocolError,
  type CommandReceipt,
  type EnqueueCommandRequest,
  type RegisterReplicaResult,
  type SnapshotId,
  type SnapshotManifest,
  type SnapshotPartPayload,
  type SyncEntity,
  type SyncEntityChange,
  type SyncPullResult,
  type SyncSubscription,
  type SyncTransactionGroup,
} from "@store/contracts";
import type {
  ReplicaInsightsFacts,
  ReplicaInsightsWindow,
} from "@store/contracts/sync/replica-insights";
import type {
  CommandStatus,
  Committed,
  ReplicaCommitNotice,
  ReplicaReadStamp,
} from "@store/contracts/sync/replica-model";
import * as Array from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import {
  ACTIVITY_COMMAND_STATUSES,
  MAX_REJECTED_ACTIVITY_ROWS,
  type ReplicaOutboxActivity,
} from "../activity";
import { admitCommand } from "../admission";
import {
  decodeEntity,
  decodeOutboxEnvelope,
  encodeEnvelopeJson,
  encodeReceiptJson,
} from "../codecs";
import type { ClaimNextUploadInput, UploadClaim } from "../commands";
import {
  generationResetNotice,
  makeReplicaCommitHub,
  mergeTouched,
  noticeFromState,
  stampOf,
  touchedOfChange,
  type TouchedSet,
} from "../commit-hub";
import {
  awaitingSnapshotCoverage,
  checkIncarnation,
  decideCoverageAfterPull,
  decideReceipt,
  isStaleClaim,
  OUTSTANDING_COMMAND_STATUSES,
  RELEASED_CLAIM_FIELDS,
  settledOutboxFields,
  shouldApplyCommitSequence,
} from "../decisions";
import { logPartitionDivergence } from "../digest";
import {
  IndexedDbCorruptRecord,
  IndexedDbIdentityMismatch,
  IndexedDbQuotaExceeded,
  IndexedDbUnavailable,
  mapReplicaStoreFailure,
  ReplicaStorageError,
} from "../errors";
import {
  integrateGroupOverPending,
  projectLocalCommand,
  restorePendingProjection,
  undoLocalEffects,
  type PendingRowStore,
} from "../pending";
import {
  announcementFields,
  decideRegistration,
  syncCursorOf,
  UNRECEIPTED_COMMAND_STATUSES,
  type ReplicaRegistrationOutcome,
} from "../registration";
import {
  ReplicaStore,
  type AppliedCursor,
  type QueuedCommand,
  type ReplicaStoreContract,
  type ReplicaStoreError,
  type SnapshotActivation,
} from "../store";
import { indexedDbPartitionDigest } from "./digest";
import { readIndexedDbInsights } from "./insights";
import {
  indexedDbCatalogReads,
  indexedDbPendingRows,
  removeEntityRow,
  writeEntityRows,
} from "./pending";
import {
  executeIndexedDbSubset,
  summarizeIndexedDbSubset,
  type IndexedDbSubsetSummary,
  type IndexedDbSubsetPlan,
  type IndexedDbSubsetRow,
} from "./query";
import {
  countOutboxWithStatus,
  ENTITY_STORES,
  outboxWithStatus,
  ReplicaIndexedDb,
  type IndexedDbTableName,
  type OutboxRow,
  type ReplicaQueryBuilder,
  type ReplicaStateRow,
} from "./schema";
import {
  abandonIndexedDbSnapshot,
  beginIndexedDbSnapshotImport,
  clearAbandonedIndexedDbImportStep,
  importIndexedDbSnapshotPart,
  promoteIndexedDbSnapshotChunk,
  switchIndexedDbSnapshot,
  sweepIndexedDbStorageStep,
} from "./snapshot";
import { withVisibleStockRows } from "./stock";

export type IndexedDbReplicaIdentity = {
  readonly organizationId: string;
  readonly userId: string;
  readonly replicaId: string;
};

type MakeIndexedDbReplicaStoreInput = {
  readonly databaseName: string;
  readonly databaseIdentity: string;
  readonly identity: IndexedDbReplicaIdentity;
  readonly indexedDB?: IDBFactory;
  readonly IDBKeyRange?: typeof IDBKeyRange;
};

const ENTITY_TABLES = [
  "command_outbox",
  "stock_overlays",
  "replica_state",
  "replica_coverage",
  "pending_row_marks",
  "pending_row_journal",
  ...ENTITY_STORES,
] as const;

const SNAPSHOT_TABLES = [...ENTITY_TABLES, "snapshot_imports", "snapshot_staged_rows"] as const;

const IMPORT_TABLES = ["snapshot_imports", ...ENTITY_STORES] as const;

const PROMOTE_TABLES = ["snapshot_imports", "snapshot_staged_rows", ...ENTITY_STORES] as const;

const SWEEP_TABLES = ["replica_state", ...PROMOTE_TABLES] as const;

const mapIndexedDbFailure = (cause: unknown): ReplicaStoreError => {
  if (cause instanceof IndexedDbDatabase.IndexedDbDatabaseError) {
    return ReplicaStorageError.make({ message: `IndexedDB ${cause.reason}` });
  }
  if (cause instanceof DOMException && cause.name === "QuotaExceededError") {
    return IndexedDbQuotaExceeded.make({ message: "IndexedDB quota exceeded." });
  }
  return mapReplicaStoreFailure(cause);
};

const missingState = () => ReplicaStorageError.make({ message: "Replica state is missing." });

const decodeOutboxRow = (row: OutboxRow) =>
  decodeOutboxEnvelope(row, (message) =>
    IndexedDbCorruptRecord.make({ message, store: "command_outbox" }),
  );

const requirePrimitives = (
  indexedDB: IDBFactory | undefined,
  IDBKeyRange: typeof globalThis.IDBKeyRange | undefined,
): Effect.Effect<
  { readonly indexedDB: IDBFactory; readonly IDBKeyRange: typeof globalThis.IDBKeyRange },
  IndexedDbUnavailable
> => {
  const factory = indexedDB ?? globalThis.indexedDB;
  const keyRange = IDBKeyRange ?? globalThis.IDBKeyRange;
  if (factory === undefined || keyRange === undefined) {
    return Effect.fail(
      IndexedDbUnavailable.make({
        message: "IndexedDB primitives are unavailable in this host.",
      }),
    );
  }
  return Effect.succeed({ indexedDB: factory, IDBKeyRange: keyRange });
};

type IndexedDbTables = Array.NonEmptyReadonlyArray<IndexedDbTableName>;

const readwrite =
  (
    api: ReplicaQueryBuilder,
    tables: IndexedDbTables,
    durability: IDBTransactionDurability = "strict",
  ) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    api.withTransaction({ tables, mode: "readwrite", durability })(effect);

const readState = (api: ReplicaQueryBuilder) =>
  api
    .from("replica_state")
    .select()
    .equals("singleton")
    .pipe(Effect.map((rows): ReplicaStateRow | undefined => rows[0]));

const requireState = (api: ReplicaQueryBuilder) =>
  readState(api).pipe(
    Effect.flatMap((state) => (state ? Effect.succeed(state) : Effect.fail(missingState()))),
  );

const bumpCommitVersion = (api: ReplicaQueryBuilder, state: ReplicaStateRow) => {
  const next = { ...state, localCommitVersion: state.localCommitVersion + 1 };
  return api
    .from("replica_state")
    .upsert(next)
    .pipe(Effect.as(stampOf(next)));
};

const firstRow = <A>(rows: ReadonlyArray<A>): A | undefined => rows[0];

const outboxRow = (api: ReplicaQueryBuilder, operationId: string) =>
  api.from("command_outbox").select().equals(operationId).pipe(Effect.map(firstRow));

const subsetTables = (plan: IndexedDbSubsetPlan): ReadonlyArray<IndexedDbTableName> =>
  plan.table === "batches"
    ? ["batches", "stock_overlays", "pending_row_marks", "command_outbox"]
    : [plan.table];

const readSubsetRows = (
  api: ReplicaQueryBuilder,
  generation: number,
  plan: IndexedDbSubsetPlan,
): Effect.Effect<ReadonlyArray<IndexedDbSubsetRow>, unknown> =>
  executeIndexedDbSubset(api, generation, plan).pipe(
    Effect.flatMap((rows) =>
      plan.table === "batches" ? withVisibleStockRows(api, rows) : Effect.succeed(rows),
    ),
  );

interface IndexedDbSubsetReader {
  readonly querySubset: (
    plan: IndexedDbSubsetPlan,
  ) => Effect.Effect<
    { readonly stamp: ReplicaReadStamp; readonly rows: ReadonlyArray<IndexedDbSubsetRow> },
    ReplicaStoreError
  >;
  readonly querySubsets: (plans: Array.NonEmptyReadonlyArray<IndexedDbSubsetPlan>) => Effect.Effect<
    {
      readonly stamp: ReplicaReadStamp;
      readonly reads: ReadonlyArray<ReadonlyArray<IndexedDbSubsetRow>>;
    },
    ReplicaStoreError
  >;
  readonly summarizeSubset: (
    plan: IndexedDbSubsetPlan,
    distinct: ReadonlyArray<string>,
    maximumValues: number,
  ) => Effect.Effect<
    { readonly stamp: ReplicaReadStamp; readonly summary: IndexedDbSubsetSummary },
    ReplicaStoreError
  >;
  readonly queryInsights: (
    window: ReplicaInsightsWindow,
  ) => Effect.Effect<
    { readonly stamp: ReplicaReadStamp; readonly facts: ReplicaInsightsFacts },
    ReplicaStoreError
  >;
}

interface IndexedDbOutboxReader {
  readonly readOutboxActivity: () => Effect.Effect<ReplicaOutboxActivity, ReplicaStoreError>;
  readonly readPendingRowIds: (
    entity: SyncEntity,
  ) => Effect.Effect<ReadonlyArray<string>, ReplicaStoreError>;
}

type IndexedDbReplicaStoreContract = ReplicaStoreContract &
  IndexedDbSubsetReader &
  IndexedDbOutboxReader;

export class IndexedDbReplicaStore extends Context.Service<
  IndexedDbReplicaStore,
  IndexedDbReplicaStoreContract
>()("@store/sync/IndexedDbReplicaStore") {}

const makeScopedIndexedDbReplicaStore = (
  input: MakeIndexedDbReplicaStoreInput,
): Effect.Effect<IndexedDbReplicaStoreContract, ReplicaStoreError, Scope.Scope> =>
  Effect.gen(function* () {
    const primitives = yield* requirePrimitives(input.indexedDB, input.IDBKeyRange);
    const { publish, commits } = yield* makeReplicaCommitHub();
    const database = yield* Layer.build(
      ReplicaIndexedDb.layer(input.databaseName).pipe(
        Layer.provide(Layer.succeed(IndexedDb.IndexedDb, IndexedDb.make(primitives))),
      ),
    ).pipe(Effect.mapError(mapIndexedDbFailure));

    const withQuery = <A>(
      run: (api: ReplicaQueryBuilder) => Effect.Effect<A, unknown>,
    ): Effect.Effect<A, ReplicaStoreError> =>
      ReplicaIndexedDb.getQueryBuilder.pipe(
        Effect.flatMap(run),
        Effect.provideContext(database),
        Effect.mapError(mapIndexedDbFailure),
        Effect.catchDefect((defect) => Effect.fail(mapIndexedDbFailure(defect))),
      );

    const commit = <A>(
      tables: IndexedDbTables,
      run: (api: ReplicaQueryBuilder) => Effect.Effect<Committed<A>, unknown>,
      durability?: IDBTransactionDurability,
    ): Effect.Effect<Committed<A>, ReplicaStoreError> =>
      withQuery((api) => readwrite(api, tables, durability)(run(api))).pipe(
        Effect.tap((committed) => publish(committed.notice)),
      );

    const readSnapshot = <A>(
      tables: ReadonlyArray<IndexedDbTableName>,
      run: (api: ReplicaQueryBuilder, state: ReplicaStateRow) => Effect.Effect<A, unknown>,
    ): Effect.Effect<A, ReplicaStoreError> =>
      withQuery((api) =>
        api.withTransaction({
          tables: ["replica_state", ...new Set(tables)],
          mode: "readonly",
          durability: "strict",
        })(requireState(api).pipe(Effect.flatMap((state) => run(api, state)))),
      );

    const notice = (
      after: ReplicaReadStamp,
      touchedEntities: ReplicaCommitNotice["touchedEntities"] = [],
      touchedKeys: ReadonlyArray<string> = [],
    ) => noticeFromState(input.databaseIdentity, after, touchedEntities, touchedKeys);

    yield* withQuery((api) =>
      Effect.gen(function* () {
        const existing = yield* readState(api);
        if (!existing) {
          yield* readwrite(api, ["replica_state"])(
            api.from("replica_state").insert({
              id: "singleton",
              organizationId: input.identity.organizationId,
              userId: input.identity.userId,
              replicaId: input.identity.replicaId,
              epoch: "1",
              incarnation: "local",
              appliedCommitSequence: "0",
              nextClientSequence: "1",
              localCommitVersion: 0,
              activeGeneration: 1,
              caughtUpAt: null,
              registeredAt: null,
            }),
          );
          return;
        }
        if (
          existing.organizationId !== input.identity.organizationId ||
          existing.userId !== input.identity.userId
        ) {
          return yield* Effect.fail(
            IndexedDbIdentityMismatch.make({
              message: "Persisted replica identity does not match the authenticated workspace.",
              expectedOrganizationId: input.identity.organizationId,
              expectedUserId: input.identity.userId,
            }),
          );
        }
      }),
    );

    const enqueueCommand = (request: EnqueueCommandRequest) =>
      commit<QueuedCommand>(ENTITY_TABLES, (api) =>
        Effect.gen(function* () {
          const state = yield* requireState(api);
          const existing = yield* outboxRow(api, request.operationId);
          const admission = yield* admitCommand(
            state,
            existing
              ? { status: existing.status, envelope: yield* decodeOutboxRow(existing) }
              : undefined,
            request,
            indexedDbCatalogReads(api, state.activeGeneration),
          );
          if (admission._tag === "replayed") {
            return {
              value: {
                operationId: request.operationId,
                status: admission.status,
                stamp: stampOf(state),
              },
              notice: undefined,
            };
          }
          const { envelope } = admission;
          const touched = yield* projectLocalCommand(
            indexedDbPendingRows(api, state.activeGeneration),
            envelope,
            { organizationId: state.organizationId, userId: state.userId },
            admission.context,
          );
          yield* api.from("command_outbox").insert({
            operationId: envelope.operationId,
            status: "pending",
            envelopeJson: encodeEnvelopeJson(envelope),
            receiptJson: null,
            clientSequence: envelope.clientSequence,
            clientSequenceLength: envelope.clientSequence.length,
            clientSequenceDigits: envelope.clientSequence,
            createdAt: request.occurredAt,
            claimId: null,
            claimedAt: null,
            attempts: 0,
            outcomeUncertain: false,
            commitSequence: null,
          });
          const after = yield* bumpCommitVersion(api, {
            ...state,
            nextClientSequence: incrementDecimalSequence(state.nextClientSequence),
          });
          return {
            value: { operationId: request.operationId, status: "pending", stamp: after },
            notice: notice(after, touched.touchedEntities, touched.touchedKeys),
          };
        }),
      );

    const claimNextUpload = (claimInput: ClaimNextUploadInput) =>
      commit<UploadClaim | undefined>(ENTITY_TABLES, (api) =>
        Effect.gen(function* () {
          const sending = yield* outboxWithStatus(api, "sending").limit(1);
          if (sending.length > 0) return { value: undefined, notice: undefined };
          const state = yield* requireState(api);
          const [next] = yield* outboxWithStatus(api, "pending").limit(1);
          if (!next) return { value: undefined, notice: undefined };
          const envelope = yield* decodeOutboxRow(next);
          const attempts = next.attempts + 1;
          yield* api.from("command_outbox").upsert({
            ...next,
            status: "sending",
            claimId: claimInput.claimId,
            claimedAt: claimInput.claimedAt,
            attempts,
          });
          const after = yield* bumpCommitVersion(api, state);
          return {
            value: {
              operationId: next.operationId,
              claimId: claimInput.claimId,
              claimedAt: claimInput.claimedAt,
              attempts,
              outcomeUncertain: next.outcomeUncertain,
              envelope,
            },
            notice: notice(after),
          };
        }),
      );

    const settleUploadClaim = (claimId: string, receipt: CommandReceipt) =>
      commit<CommandStatus | undefined>(ENTITY_TABLES, (api) =>
        Effect.gen(function* () {
          const row = yield* outboxRow(api, receipt.operationId);
          if (!row) return { value: undefined, notice: undefined };
          const envelope = yield* decodeOutboxRow(row);
          const claimMatches = row.status === "sending" && row.claimId === claimId;
          const decision = yield* Effect.fromResult(
            decideReceipt(row.status, envelope, receipt, claimMatches),
          );
          if (decision._tag === "noop") return { value: decision.status, notice: undefined };
          const settled = settledOutboxFields(receipt, encodeReceiptJson(receipt));
          if (decision._tag === "refreshIntegrated") {
            yield* api.from("command_outbox").upsert({ ...row, ...settled });
            return { value: decision.status, notice: undefined };
          }
          const state = yield* requireState(api);
          const restored =
            decision._tag === "rejected"
              ? yield* undoLocalEffects(
                  indexedDbPendingRows(api, state.activeGeneration),
                  receipt.operationId,
                )
              : undefined;
          yield* api.from("command_outbox").upsert({ ...row, ...settled, status: decision.status });
          const after = yield* bumpCommitVersion(api, state);
          return {
            value: decision.status,
            notice: notice(after, restored?.touchedEntities, restored?.touchedKeys),
          };
        }),
      );

    const releaseUploadClaim = (operationId: string, claimId: string) =>
      commit<CommandStatus | undefined>(["replica_state", "command_outbox"], (api) =>
        Effect.gen(function* () {
          const row = yield* outboxRow(api, operationId);
          if (!row || row.status !== "sending" || row.claimId !== claimId) {
            return { value: row?.status, notice: undefined };
          }
          const state = yield* requireState(api);
          yield* api.from("command_outbox").upsert({ ...row, ...RELEASED_CLAIM_FIELDS });
          const after = yield* bumpCommitVersion(api, state);
          const status = RELEASED_CLAIM_FIELDS.status;
          return { value: status, notice: notice(after) };
        }),
      );

    const recoverStaleUploadClaims = (staleBefore: number) =>
      commit<number>(["replica_state", "command_outbox"], (api) =>
        Effect.gen(function* () {
          const sending = yield* outboxWithStatus(api, "sending");
          const stale = sending.filter((row) => isStaleClaim(row, staleBefore));
          if (stale.length === 0) return { value: 0, notice: undefined };
          for (const row of stale) {
            yield* api.from("command_outbox").upsert({ ...row, ...RELEASED_CLAIM_FIELDS });
          }
          const after = yield* bumpCommitVersion(api, yield* requireState(api));
          return { value: stale.length, notice: notice(after) };
        }),
      );

    const applyGroupWithin = (
      api: ReplicaQueryBuilder,
      rows: PendingRowStore<unknown>,
      group: SyncTransactionGroup,
    ) =>
      Effect.gen(function* () {
        const touched = yield* integrateGroupOverPending(rows, group);
        const outbox = yield* outboxRow(api, group.operationId);
        if (outbox && outbox.status !== "rejected") {
          yield* api.from("command_outbox").upsert({ ...outbox, status: "integrated" });
        }
        return touched;
      });

    const hasPendingProjection = (api: ReplicaQueryBuilder) =>
      Effect.gen(function* () {
        const marks = yield* api.from("pending_row_marks").count();
        const overlays = yield* api.from("stock_overlays").count();
        return marks + overlays > 0;
      });

    const applySettledGroups = (
      api: ReplicaQueryBuilder,
      generation: number,
      rows: PendingRowStore<unknown>,
      groups: ReadonlyArray<SyncTransactionGroup>,
    ) =>
      Effect.gen(function* () {
        const latest = new Map<SyncEntity, Map<string, SyncEntityChange>>();
        const touched: Array<TouchedSet> = [];
        for (const group of groups) {
          for (const change of group.changes) {
            touched.push(touchedOfChange(change.entity, change.entityId));
            const byId = latest.get(change.entity) ?? new Map<string, SyncEntityChange>();
            byId.set(change.entityId, change);
            latest.set(change.entity, byId);
          }
        }
        for (const [entity, byId] of latest) {
          const changes = [...byId.values()];
          yield* writeEntityRows(
            api,
            generation,
            entity,
            changes.flatMap((change) => (change.action === "delete" ? [] : [change.row])),
          );
          for (const change of changes) {
            if (change.action === "delete") {
              yield* removeEntityRow(api, generation, entity, change.entityId);
            }
          }
        }
        const outstanding = (yield* Effect.forEach(OUTSTANDING_COMMAND_STATUSES, (status) =>
          outboxWithStatus(api, status),
        )).flat();
        const integrated = new Set(groups.map((group) => group.operationId));
        for (const row of outstanding) {
          if (integrated.has(row.operationId)) {
            yield* api.from("command_outbox").upsert({ ...row, status: "integrated" });
          }
        }
        for (const group of groups) {
          if (group.decision === "rejected") {
            touched.push(yield* restorePendingProjection(rows, group.operationId));
          }
        }
        return mergeTouched(...touched);
      });

    const applyGroups = (groups: ReadonlyArray<SyncTransactionGroup>, incarnation?: string) =>
      commit<string>(
        ENTITY_TABLES,
        (api) =>
          Effect.gen(function* () {
            const state = yield* requireState(api);
            if (incarnation !== undefined) {
              yield* Effect.fromResult(checkIncarnation(state.incarnation, incarnation));
            }
            const due: Array<SyncTransactionGroup> = [];
            let appliedThrough = state.appliedCommitSequence;
            for (const group of groups) {
              if (!shouldApplyCommitSequence(appliedThrough, group.commitSequence)) continue;
              due.push(group);
              appliedThrough = group.commitSequence;
            }
            if (due.length === 0) return { value: appliedThrough, notice: undefined };
            const generation = state.activeGeneration;
            const rows = indexedDbPendingRows(api, generation);
            const applied = (yield* hasPendingProjection(api))
              ? mergeTouched(
                  ...(yield* Effect.forEach(due, (group) => applyGroupWithin(api, rows, group))),
                )
              : yield* applySettledGroups(api, generation, rows, due);
            const after = yield* bumpCommitVersion(api, {
              ...state,
              appliedCommitSequence: appliedThrough,
            });
            return {
              value: appliedThrough,
              notice: notice(after, applied.touchedEntities, applied.touchedKeys),
            };
          }),
        "relaxed",
      );

    const applyTransactionGroup = (group: SyncTransactionGroup) => applyGroups([group]);

    const recordPulledCoverage = (page: SyncPullResult, appliedThrough: string) =>
      withQuery((api) =>
        Effect.gen(function* () {
          const existing = firstRow(
            yield* api.from("replica_coverage").select().equals(page.subscription),
          );
          const write = readwrite(api, ["replica_coverage"]);
          const localDigest =
            page.digest === undefined ? undefined : yield* indexedDbPartitionDigest(api);
          const next = decideCoverageAfterPull(localDigest, page.digest);
          if (next._tag === "repair") {
            yield* logPartitionDivergence(page.subscription, next.diverged);
            yield* write(
              api.from("replica_coverage").upsert(awaitingSnapshotCoverage(page.subscription)),
            );
            return { repairRequired: true, digestVerified: false };
          }
          if (next._tag === "record") {
            yield* write(
              api.from("replica_coverage").upsert({
                subscription: page.subscription,
                state: "downloaded",
                throughCommitSequence: appliedThrough,
                digest: next.digest,
                verifiedAt: existing?.verifiedAt ?? null,
              }),
            );
            return { repairRequired: false, digestVerified: next.verified };
          }
          if (!existing) {
            yield* write(
              api.from("replica_coverage").insert({
                subscription: page.subscription,
                state: "downloaded",
                throughCommitSequence: appliedThrough,
                digest: null,
                verifiedAt: null,
              }),
            );
          }
          return { repairRequired: false, digestVerified: false };
        }),
      );

    const applyRemotePage = Effect.fn("IndexedDbReplicaStore.applyRemotePage")(function* (
      page: SyncPullResult,
    ) {
      const applied = yield* applyGroups(page.transactions, page.incarnation);
      const coverage = yield* recordPulledCoverage(page, applied.value);
      return {
        value: {
          appliedThrough: applied.value,
          repairRequired: coverage.repairRequired,
          digestVerified: coverage.digestVerified,
        },
        notice: applied.notice,
      } satisfies Committed<AppliedCursor>;
    });

    const settleUploadWithPage = Effect.fn("IndexedDbReplicaStore.settleUploadWithPage")(function* (
      claimId: string,
      receipt: CommandReceipt,
      page: SyncPullResult,
    ) {
      const settled = yield* settleUploadClaim(claimId, receipt);
      const applied = yield* applyRemotePage(page);
      return {
        value: applied.value,
        notice: applied.notice ?? settled.notice,
      } satisfies Committed<AppliedCursor>;
    });

    const readStateWith = <A>(project: (state: ReplicaStateRow) => A) =>
      withQuery((api) => requireState(api).pipe(Effect.map(project)));

    const markCoverageRepair = (subscription: SyncSubscription) =>
      withQuery((api) =>
        readwrite(api, ["replica_coverage"])(
          api.from("replica_coverage").upsert(awaitingSnapshotCoverage(subscription)),
        ),
      );

    const recordDigestVerification = (subscription: SyncSubscription, verifiedAt: number) =>
      withQuery((api) =>
        Effect.gen(function* () {
          const existing = firstRow(
            yield* api.from("replica_coverage").select().equals(subscription),
          );
          yield* readwrite(api, ["replica_coverage"])(
            api.from("replica_coverage").upsert({
              subscription,
              state: existing?.state ?? "downloaded",
              throughCommitSequence: existing?.throughCommitSequence ?? null,
              digest: existing?.digest ?? null,
              verifiedAt,
            }),
          );
        }),
      );

    const recordCaughtUp = (caughtUpAt: number) =>
      commit<void>(["replica_state"], (api) =>
        Effect.gen(function* () {
          const state = yield* requireState(api);
          yield* api.from("replica_state").upsert({ ...state, caughtUpAt });
          return { value: undefined, notice: notice(stampOf(state)) };
        }),
      );

    const adoptRegistration = (authority: RegisterReplicaResult, registeredAt: number) =>
      withQuery((api) =>
        readwrite(api, ["replica_state", "command_outbox"])(
          Effect.gen(function* () {
            const state = yield* requireState(api);
            const rows = yield* Effect.forEach(UNRECEIPTED_COMMAND_STATUSES, (status) =>
              outboxWithStatus(api, status),
            ).pipe(Effect.map((groups) => groups.flat()));
            const outbox = yield* Effect.forEach(rows, (row) =>
              decodeOutboxRow(row).pipe(Effect.map((envelope) => ({ ...row, envelope }))),
            );
            const decision = decideRegistration(state, outbox, authority);
            if (decision._tag === "refuse") {
              return {
                _tag: "refused",
                code: decision.code,
                message: decision.message,
              } satisfies ReplicaRegistrationOutcome;
            }
            if (decision._tag === "adopt") {
              const byOperation = new Map(rows.map((row) => [row.operationId, row]));
              for (const restamped of decision.restamp) {
                const row = byOperation.get(restamped.operationId);
                if (row === undefined) continue;
                const clientSequence = restamped.envelope.clientSequence;
                yield* api.from("command_outbox").upsert({
                  ...row,
                  envelopeJson: encodeEnvelopeJson(restamped.envelope),
                  clientSequence,
                  clientSequenceLength: clientSequence.length,
                  clientSequenceDigits: clientSequence,
                });
              }
              yield* api.from("replica_state").upsert({
                ...state,
                epoch: decision.epoch,
                incarnation: decision.incarnation,
                nextClientSequence: decision.nextClientSequence,
                registeredAt,
                ...announcementFields(authority),
              });
              return { _tag: "registered" } satisfies ReplicaRegistrationOutcome;
            }
            yield* api.from("replica_state").upsert({ ...state, ...announcementFields(authority) });
            return { _tag: "registered" } satisfies ReplicaRegistrationOutcome;
          }),
        ),
      ).pipe(
        Effect.tap((outcome) =>
          outcome._tag === "registered"
            ? readSnapshot([], (_api, state) => publish(notice(stampOf(state))))
            : Effect.void,
        ),
      );

    const readOutboxActivity = () =>
      withQuery((api) =>
        api.withTransaction({
          tables: ["command_outbox", "replica_state"],
          mode: "readonly",
          durability: "strict",
        })(
          Effect.gen(function* () {
            const state = yield* requireState(api);
            const statusCounts = yield* Effect.forEach(ACTIVITY_COMMAND_STATUSES, (status) =>
              countOutboxWithStatus(api, status).pipe(Effect.map((count) => ({ status, count }))),
            );
            const rejected = yield* outboxWithStatus(api, "rejected")
              .reverse()
              .limit(MAX_REJECTED_ACTIVITY_ROWS);
            return {
              statusCounts: statusCounts.filter((entry) => entry.count > 0),
              rejected: rejected.map((row) => ({
                operationId: row.operationId,
                clientSequence: row.clientSequence,
                createdAt: row.createdAt,
                envelopeJson: row.envelopeJson,
                receiptJson: row.receiptJson,
              })),
              caughtUpAt: state.caughtUpAt,
              lowestActiveSchemaVersion: state.lowestActiveSchemaVersion ?? null,
            } satisfies ReplicaOutboxActivity;
          }),
        ),
      );

    const readPendingRowIds = (entity: SyncEntity) =>
      withQuery((api) => {
        const lower: [SyncEntity] = [entity];
        const upper: [SyncEntity, []] = [entity, []];
        return api.from("pending_row_marks").select().between(lower, upper);
      }).pipe(Effect.map((rows) => rows.map((row) => row.entityId)));

    const sweepRequests = yield* Queue.sliding<void>(1);
    const requestSweep = Queue.offer(sweepRequests, undefined).pipe(Effect.asVoid);
    const sweepStep = withQuery((api) =>
      readwrite(api, SWEEP_TABLES)(sweepIndexedDbStorageStep(api)),
    );
    const sweep = Effect.repeat(sweepStep.pipe(Effect.tap(() => Effect.yieldNow)), {
      until: (step) => !step.remaining,
    }).pipe(
      Effect.tapError((error) => Effect.logWarning("Replica generation sweep failed", error)),
      Effect.ignore,
    );
    yield* Stream.fromQueue(sweepRequests).pipe(
      Stream.mapEffect(() => sweep),
      Stream.runDrain,
      Effect.forkScoped,
    );
    yield* requestSweep;

    const promoteSnapshot = (snapshotId: SnapshotId) =>
      Effect.repeat(
        withQuery((api) =>
          readwrite(api, PROMOTE_TABLES)(promoteIndexedDbSnapshotChunk(api, snapshotId)),
        ).pipe(Effect.tap(() => Effect.yieldNow)),
        { until: (chunk) => !chunk.remaining },
      );

    const clearAbandonedImport = (snapshotId: SnapshotId) =>
      Effect.repeat(
        withQuery((api) =>
          readwrite(api, ["snapshot_imports", "snapshot_staged_rows"])(
            clearAbandonedIndexedDbImportStep(api, snapshotId),
          ),
        ).pipe(Effect.tap(() => Effect.yieldNow)),
        { until: (step) => !step.remaining },
      );

    return {
      readSyncCursor: () => readStateWith(syncCursorOf),
      adoptRegistration,
      enqueueCommand,
      claimNextUpload,
      settleUploadClaim,
      settleUploadWithPage,
      releaseUploadClaim,
      recoverStaleUploadClaims,
      applyRemotePage,
      applyTransactionGroup,
      beginSnapshotImport: (manifest: SnapshotManifest) =>
        clearAbandonedImport(manifest.snapshotId).pipe(
          Effect.andThen(
            withQuery((api) =>
              readwrite(api, ["replica_state", "snapshot_imports", "snapshot_staged_rows"])(
                requireState(api).pipe(
                  Effect.flatMap((state) =>
                    beginIndexedDbSnapshotImport(api, state.activeGeneration, manifest),
                  ),
                ),
              ),
            ),
          ),
        ),
      importSnapshotPart: (manifest: SnapshotManifest, part: SnapshotPartPayload) =>
        withQuery((api) =>
          readwrite(
            api,
            IMPORT_TABLES,
            "relaxed",
          )(importIndexedDbSnapshotPart(api, manifest, part)),
        ),
      applyCandidateAuthority: () =>
        Effect.fail(
          syncProtocolError(
            "SNAPSHOT_UNAVAILABLE",
            "The web replica does not stage authority catch-up.",
          ),
        ),
      abandonSnapshot: (snapshotId: SnapshotId) =>
        withQuery((api) =>
          readwrite(api, ["snapshot_imports"])(abandonIndexedDbSnapshot(api, snapshotId)),
        ).pipe(Effect.andThen(requestSweep)),
      activateSnapshot: (snapshotId: SnapshotId) =>
        promoteSnapshot(snapshotId).pipe(
          Effect.andThen(
            commit<SnapshotActivation>(SNAPSHOT_TABLES, (api) =>
              switchIndexedDbSnapshot(api, snapshotId).pipe(
                Effect.map((activated) => ({
                  value: { _tag: "activated" as const },
                  notice: generationResetNotice(input.databaseIdentity, stampOf(activated)),
                })),
              ),
            ),
          ),
          Effect.tap(() => requestSweep),
        ),
      markCoverageRepair,
      readDigestVerification: (subscription: SyncSubscription) =>
        withQuery((api) => api.from("replica_coverage").select().equals(subscription)).pipe(
          Effect.map((rows) => firstRow(rows)?.verifiedAt ?? undefined),
        ),
      recordDigestVerification,
      readCommandStatus: (operationId) =>
        withQuery((api) => outboxRow(api, operationId)).pipe(Effect.map((row) => row?.status)),
      readPendingMarks: () =>
        withQuery((api) =>
          api
            .from("pending_row_marks")
            .select()
            .pipe(
              Effect.map((rows) =>
                rows.map((row) => ({
                  entity: decodeEntity(row.entity),
                  entityId: row.entityId,
                  operationId: row.operationId,
                })),
              ),
            ),
        ),
      readStamp: () => readStateWith(stampOf),
      recordCaughtUp,
      readOutboxActivity,
      readPendingRowIds,
      querySubset: (plan: IndexedDbSubsetPlan) =>
        readSnapshot(subsetTables(plan), (api, state) =>
          readSubsetRows(api, state.activeGeneration, plan).pipe(
            Effect.map((rows) => ({ stamp: stampOf(state), rows })),
          ),
        ),
      querySubsets: (plans: Array.NonEmptyReadonlyArray<IndexedDbSubsetPlan>) =>
        readSnapshot(Array.flatMap(plans, subsetTables), (api, state) =>
          Effect.forEach(plans, (plan) => readSubsetRows(api, state.activeGeneration, plan)).pipe(
            Effect.map((reads) => ({ stamp: stampOf(state), reads })),
          ),
        ),
      summarizeSubset: (
        plan: IndexedDbSubsetPlan,
        distinct: ReadonlyArray<string>,
        maximumValues: number,
      ) =>
        withQuery((api) =>
          Effect.gen(function* () {
            const state = yield* requireState(api);
            const summary = yield* summarizeIndexedDbSubset(
              api,
              state.activeGeneration,
              plan,
              distinct,
              maximumValues,
            );
            return { stamp: stampOf(state), summary };
          }),
        ),
      queryInsights: (window: ReplicaInsightsWindow) =>
        withQuery((api) =>
          Effect.gen(function* () {
            const state = yield* requireState(api);
            const facts = yield* readIndexedDbInsights(api, state.activeGeneration, window);
            return { stamp: stampOf(state), facts };
          }),
        ),
      commits,
    };
  });

export const layerIndexedDbReplicaStore = (
  input: MakeIndexedDbReplicaStoreInput,
): Layer.Layer<ReplicaStore | IndexedDbReplicaStore, ReplicaStoreError> =>
  Layer.effectContext(
    makeScopedIndexedDbReplicaStore(input).pipe(
      Effect.map((store) =>
        Context.make(ReplicaStore, store).pipe(Context.add(IndexedDbReplicaStore, store)),
      ),
    ),
  );

export type {
  IndexedDbEntityTable,
  IndexedDbResidualPredicate,
  IndexedDbScan,
  IndexedDbSubsetPlan,
} from "./query";
