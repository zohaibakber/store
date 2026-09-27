import * as IndexedDb from "@effect/platform-browser/IndexedDb";
import * as IndexedDbDatabase from "@effect/platform-browser/IndexedDbDatabase";
import {
  type CommandReceipt,
  type RegisterReplicaResult,
  type SnapshotId,
  type SnapshotManifest,
  type SnapshotPartPayload,
  type SyncCommandEnvelope,
  type SyncEntity,
  type SyncPullResult,
  type SyncSubscription,
  type SyncTransactionGroup,
} from "@store/contracts";
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
import type * as Scope from "effect/Scope";

import { withDetachedScope } from "../../detached-scope";
import {
  ACTIVITY_COMMAND_STATUSES,
  MAX_REJECTED_ACTIVITY_ROWS,
  type ReplicaOutboxActivity,
} from "../activity";
import {
  decodeCategoryRow,
  decodeEntity,
  decodeOutboxEnvelope,
  decodeInvoiceRow,
  encodeEnvelopeJson,
  encodeReceiptJson,
} from "../codecs";
import type { ClaimNextUploadInput, UploadClaim } from "../commands";
import {
  makeReplicaCommitHub,
  noticeFromState,
  stampOf,
  touchedEntitiesWithStock,
} from "../commit-hub";
import {
  awaitingSnapshotCoverage,
  byClientSequence,
  checkAuthorityHead,
  checkIncarnation,
  decideCoverageAfterPull,
  decideEnqueue,
  decideReceipt,
  isStaleClaim,
  localPartitionDigest,
  nextUploadClaim,
  RELEASED_CLAIM_FIELDS,
  settledOutboxFields,
  shouldApplyCommitSequence,
  SYNC_ENTITIES,
  type PartitionRowSource,
} from "../decisions";
import {
  IndexedDbCorruptRecord,
  IndexedDbIdentityMismatch,
  IndexedDbQuotaExceeded,
  IndexedDbUnavailable,
  IndexedDbUpgradeBlocked,
  mapReplicaStoreFailure,
  ReplicaStorageError,
} from "../errors";
import { checkEnqueueAllowed, type PendingRestoreResult } from "../projection";
import {
  decideRegistration,
  UNRECEIPTED_COMMAND_STATUSES,
  type ReplicaRegistrationOutcome,
} from "../registration";
import {
  ReplicaStore,
  type AppliedCursor,
  type QueuedCommand,
  type ReplicaStoreContract,
  type ReplicaStoreError,
  type VerifyAuthorityInput,
} from "../store";
import {
  clearIndexedDbPendingProjection,
  indexedDbCatalogLookup,
  removeEntityRow,
  renameIndexedDbCollidingCategory,
  renumberIndexedDbCollidingInvoice,
  resolveIndexedDbRemoteRow,
  restoreIndexedDbPendingProjection,
  writeEntityRow,
  writeIndexedDbPendingProjection,
} from "./pending";
import {
  executeIndexedDbSubset,
  generationBounds,
  type IndexedDbSubsetPlan,
  type IndexedDbSubsetRow,
} from "./query";
import {
  countOutboxWithStatus,
  outboxWithStatus,
  ReplicaIndexedDb,
  type OutboxRow,
  type ReplicaQueryBuilder,
  type ReplicaStateRow,
} from "./schema";
import {
  activateIndexedDbSnapshot,
  beginIndexedDbSnapshotImport,
  importIndexedDbSnapshotPart,
} from "./snapshot";
import { makeIndexedDbStockCache } from "./stock";

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

type IndexedDbTableName = Parameters<ReplicaQueryBuilder["from"]>[0];

const ENTITY_TABLES = [
  "categories",
  "products",
  "batches",
  "invoices",
  "invoice_items",
  "stock_movements",
  "command_outbox",
  "stock_overlays",
  "replica_state",
  "replica_coverage",
  "pending_row_marks",
  "pending_row_journal",
] as const;

const SNAPSHOT_TABLES = [...ENTITY_TABLES, "snapshot_imports", "snapshot_staged_rows"] as const;

const mapIndexedDbFailure = (cause: unknown): ReplicaStoreError => {
  if (cause instanceof IndexedDbDatabase.IndexedDbDatabaseError) {
    if (cause.reason === "Blocked") {
      return IndexedDbUpgradeBlocked.make({
        message: "IndexedDB upgrade is blocked by another connection.",
      });
    }
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
  (api: ReplicaQueryBuilder, tables: IndexedDbTables) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    api.withTransaction({ tables, mode: "readwrite", durability: "strict" })(effect);

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

const indexedDbLocalDigest = (api: ReplicaQueryBuilder, page: SyncPullResult) =>
  Effect.gen(function* () {
    const state = yield* requireState(api);
    const [lower, upper] = generationBounds(state.activeGeneration);
    const marks = yield* api.from("pending_row_marks").select();
    const categoryRows = yield* api.from("categories").select().between(lower, upper);
    const productRows = yield* api.from("products").select().between(lower, upper);
    const batchRows = yield* api.from("batches").select().between(lower, upper);
    const sources: ReadonlyArray<PartitionRowSource> = [
      ...categoryRows.map(({ generation: _generation, ...row }) => ({
        entity: "category" as const,
        row,
      })),
      ...productRows.map(({ generation: _generation, ...row }) => ({
        entity: "product" as const,
        row,
      })),
      ...batchRows.map(({ generation: _generation, ...row }) => ({
        entity: "batch" as const,
        row,
      })),
    ];
    return localPartitionDigest(
      page.subscription,
      sources,
      marks.map((mark) => ({ entity: decodeEntity(mark.entity) })),
    );
  });

const undoLocalEffects = (
  api: ReplicaQueryBuilder,
  generation: number,
  operationId: string,
): Effect.Effect<PendingRestoreResult, unknown> =>
  api
    .from("stock_overlays")
    .delete("byCommand")
    .equals(operationId)
    .pipe(Effect.andThen(restoreIndexedDbPendingProjection(api, generation, operationId)));

export type IndexedDbReplicaStoreContract = ReplicaStoreContract & {
  readonly querySubset: (
    plan: IndexedDbSubsetPlan,
  ) => Effect.Effect<
    { readonly stamp: ReplicaReadStamp; readonly rows: ReadonlyArray<IndexedDbSubsetRow> },
    ReplicaStoreError
  >;
  readonly listOutboxStatuses: () => Effect.Effect<ReadonlyArray<CommandStatus>, ReplicaStoreError>;
  readonly readOutboxActivity: () => Effect.Effect<ReplicaOutboxActivity, ReplicaStoreError>;
  readonly readPendingRowIds: (
    entity: SyncEntity,
  ) => Effect.Effect<ReadonlyArray<string>, ReplicaStoreError>;
  readonly readCommandAllocation: () => Effect.Effect<
    { readonly epoch: string; readonly nextClientSequence: string },
    ReplicaStoreError
  >;
};

export type DisposableIndexedDbReplicaStore = IndexedDbReplicaStoreContract & {
  readonly dispose: () => Effect.Effect<void>;
};

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
    ): Effect.Effect<Committed<A>, ReplicaStoreError> =>
      withQuery((api) => readwrite(api, tables)(run(api))).pipe(
        Effect.tap((committed) => publish(committed.notice)),
      );

    const notice = (
      after: ReplicaReadStamp,
      touchedEntities: ReplicaCommitNotice["touchedEntities"] = [],
      touchedKeys: ReadonlyArray<string> = [],
      commandStatuses?: ReplicaCommitNotice["commandStatuses"],
    ) =>
      noticeFromState(input.databaseIdentity, after, touchedEntities, touchedKeys, commandStatuses);

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

    const enqueueCommand = (envelope: SyncCommandEnvelope, createdAt: number) =>
      commit<QueuedCommand>(ENTITY_TABLES, (api) =>
        Effect.gen(function* () {
          const state = yield* requireState(api);
          const existing = yield* outboxRow(api, envelope.operationId);
          const existingEntry = existing
            ? { status: existing.status, envelope: yield* decodeOutboxRow(existing) }
            : undefined;
          const stock = makeIndexedDbStockCache(api, state.activeGeneration);
          if (!existing) yield* stock.load(envelope);
          const decision = yield* Effect.fromResult(
            decideEnqueue(state, existingEntry, envelope, stock.unitsPerPackFor, stock.stockFor),
          );
          if (decision._tag === "replay") {
            return {
              value: { operationId: envelope.operationId, status: decision.status },
              notice: undefined,
            };
          }
          const lookup = yield* indexedDbCatalogLookup(api, state.activeGeneration);
          yield* checkEnqueueAllowed(envelope, lookup, stock.unitsPerPackFor, stock.stockFor);
          for (const overlay of decision.overlays) {
            yield* api.from("stock_overlays").insert(overlay);
          }
          const projection = yield* writeIndexedDbPendingProjection(
            api,
            state.activeGeneration,
            { organizationId: state.organizationId, userId: state.userId },
            lookup,
            envelope,
          );
          yield* api.from("command_outbox").insert({
            operationId: envelope.operationId,
            status: "pending",
            envelopeJson: encodeEnvelopeJson(envelope),
            receiptJson: null,
            clientSequence: envelope.clientSequence,
            clientSequenceLength: envelope.clientSequence.length,
            clientSequenceDigits: envelope.clientSequence,
            createdAt,
            claimId: null,
            claimedAt: null,
            attempts: 0,
            outcomeUncertain: false,
            commitSequence: null,
          });
          const after = yield* bumpCommitVersion(api, {
            ...state,
            nextClientSequence: decision.nextClientSequence,
          });
          return {
            value: { operationId: envelope.operationId, status: decision.status },
            notice: notice(
              after,
              touchedEntitiesWithStock(projection.touchedEntities),
              projection.touchedKeys,
              [{ operationId: envelope.operationId, status: decision.status }],
            ),
          };
        }),
      );

    const claimNextUpload = (claimInput: ClaimNextUploadInput) =>
      commit<UploadClaim | undefined>(ENTITY_TABLES, (api) =>
        Effect.gen(function* () {
          const sending = yield* outboxWithStatus(api, "sending");
          if (sending.length > 0) return { value: undefined, notice: undefined };
          const state = yield* requireState(api);
          const pending = yield* outboxWithStatus(api, "pending");
          const next = nextUploadClaim(Array.sort(pending, byClientSequence));
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
            notice: notice(after, [], [], [{ operationId: next.operationId, status: "sending" }]),
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
              ? yield* undoLocalEffects(api, state.activeGeneration, receipt.operationId)
              : undefined;
          yield* api.from("command_outbox").upsert({ ...row, ...settled, status: decision.status });
          const after = yield* bumpCommitVersion(api, state);
          return {
            value: decision.status,
            notice: notice(
              after,
              touchedEntitiesWithStock(restored?.touchedEntities),
              restored?.touchedKeys ?? [],
              [{ operationId: receipt.operationId, status: decision.status }],
            ),
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
          return { value: status, notice: notice(after, [], [], [{ operationId, status }]) };
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

    const applyTransactionGroup = (group: SyncTransactionGroup) =>
      commit<string>(ENTITY_TABLES, (api) =>
        Effect.gen(function* () {
          const state = yield* requireState(api);
          if (!shouldApplyCommitSequence(state.appliedCommitSequence, group.commitSequence)) {
            return { value: state.appliedCommitSequence, notice: undefined };
          }
          const generation = state.activeGeneration;
          const touchedKeys: Array<string> = [];
          for (const change of group.changes) {
            if (change.action === "delete") {
              yield* removeEntityRow(api, generation, change.entity, change.entityId);
            } else {
              if (change.entity === "invoice") {
                const renumbered = yield* renumberIndexedDbCollidingInvoice(
                  api,
                  generation,
                  decodeInvoiceRow(change.row),
                  group.operationId,
                );
                if (renumbered) touchedKeys.push(renumbered);
              }
              if (change.entity === "category") {
                const renamed = yield* renameIndexedDbCollidingCategory(
                  api,
                  generation,
                  decodeCategoryRow(change.row),
                  group.operationId,
                );
                if (renamed) touchedKeys.push(renamed);
              }
              yield* writeEntityRow(api, generation, change.entity, change.row);
            }
            yield* resolveIndexedDbRemoteRow(api, change.entity, change.entityId);
          }
          if (group.decision === "rejected") {
            yield* restoreIndexedDbPendingProjection(api, generation, group.operationId);
          } else {
            yield* clearIndexedDbPendingProjection(api, group.operationId);
          }
          yield* api.from("stock_overlays").delete("byCommand").equals(group.operationId);
          const outbox = yield* outboxRow(api, group.operationId);
          if (outbox && outbox.status !== "rejected") {
            yield* api.from("command_outbox").upsert({ ...outbox, status: "integrated" });
          }
          const after = yield* bumpCommitVersion(api, {
            ...state,
            appliedCommitSequence: group.commitSequence,
          });
          return { value: group.commitSequence, notice: notice(after, SYNC_ENTITIES, touchedKeys) };
        }),
      );

    const recordPulledCoverage = (page: SyncPullResult, appliedThrough: string) =>
      withQuery((api) =>
        Effect.gen(function* () {
          const existing = firstRow(
            yield* api.from("replica_coverage").select().equals(page.subscription),
          );
          const write = readwrite(api, ["replica_coverage"]);
          const localDigest =
            page.digest === undefined ? undefined : yield* indexedDbLocalDigest(api, page);
          const next = decideCoverageAfterPull(localDigest, page.digest);
          if (next._tag === "repair") {
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
      const baseline = yield* withQuery((api) =>
        Effect.gen(function* () {
          const state = yield* requireState(api);
          yield* Effect.fromResult(checkIncarnation(state.incarnation, page.incarnation));
          return state.appliedCommitSequence;
        }),
      );
      let appliedThrough = baseline;
      let lastNotice: ReplicaCommitNotice | undefined;
      for (const group of page.transactions) {
        const applied = yield* applyTransactionGroup(group);
        appliedThrough = applied.value;
        lastNotice = applied.notice ?? lastNotice;
      }
      const coverage = yield* recordPulledCoverage(page, appliedThrough);
      return {
        value: {
          appliedThrough,
          repairRequired: coverage.repairRequired,
          digestVerified: coverage.digestVerified,
        },
        notice: lastNotice,
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
              });
            }
            return { _tag: "registered" } satisfies ReplicaRegistrationOutcome;
          }),
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
              caughtUpAt: state.caughtUpAt ?? null,
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

    return {
      readSyncCursor: () =>
        readStateWith((state) => ({
          epoch: state.epoch,
          appliedCommitSequence: state.appliedCommitSequence,
          replicaId: state.replicaId,
          registered: state.registeredAt !== undefined,
        })),
      adoptRegistration,
      enqueueCommand,
      claimNextUpload,
      settleUploadClaim,
      releaseUploadClaim,
      recoverStaleUploadClaims,
      applyRemotePage,
      applyTransactionGroup,
      beginSnapshotImport: (manifest: SnapshotManifest) =>
        withQuery((api) =>
          readwrite(api, ["replica_state", "snapshot_imports"])(
            requireState(api).pipe(
              Effect.flatMap((state) =>
                beginIndexedDbSnapshotImport(api, state.activeGeneration, manifest),
              ),
            ),
          ),
        ),
      importSnapshotPart: (manifest: SnapshotManifest, part: SnapshotPartPayload) =>
        withQuery((api) =>
          readwrite(api, ["snapshot_imports", "snapshot_staged_rows"])(
            importIndexedDbSnapshotPart(api, manifest, part),
          ),
        ),
      activateSnapshot: (snapshotId: SnapshotId) =>
        commit<void>(SNAPSHOT_TABLES, (api) =>
          activateIndexedDbSnapshot(api, snapshotId).pipe(
            Effect.map((activated) => ({
              value: undefined,
              notice: notice(stampOf(activated), SYNC_ENTITIES),
            })),
          ),
        ),
      verifyAuthority: (authority: VerifyAuthorityInput) =>
        withQuery((api) =>
          requireState(api).pipe(
            Effect.flatMap((state) =>
              Effect.fromResult(checkIncarnation(state.incarnation, authority.incarnation)).pipe(
                Effect.andThen(
                  Effect.fromResult(
                    checkAuthorityHead(state.appliedCommitSequence, authority.horizon),
                  ),
                ),
              ),
            ),
          ),
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
      listOutboxStatuses: () =>
        withQuery((api) => api.from("command_outbox").select()).pipe(
          Effect.map((rows) => rows.map((row) => row.status)),
        ),
      readCommandAllocation: () =>
        readStateWith((state) => ({
          epoch: state.epoch,
          nextClientSequence: state.nextClientSequence,
        })),
      readStamp: () => readStateWith(stampOf),
      recordCaughtUp,
      readOutboxActivity,
      readPendingRowIds,
      querySubset: (plan: IndexedDbSubsetPlan) =>
        withQuery((api) =>
          api.withTransaction({
            tables: [plan.table, "replica_state"],
            mode: "readonly",
            durability: "strict",
          })(
            Effect.gen(function* () {
              const state = yield* requireState(api);
              const rows = yield* executeIndexedDbSubset(api, state.activeGeneration, plan);
              return { stamp: stampOf(state), rows };
            }),
          ),
        ),
      commits,
    };
  });

export const makeIndexedDbReplicaStore = (
  input: MakeIndexedDbReplicaStoreInput,
): Effect.Effect<DisposableIndexedDbReplicaStore, ReplicaStoreError> =>
  withDetachedScope(makeScopedIndexedDbReplicaStore(input)).pipe(
    Effect.map(({ value, close }) => ({ ...value, dispose: () => close })),
  );

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

export const requireIndexedDbPrimitives = () => requirePrimitives(undefined, undefined);

export {
  IndexedDbCorruptRecord,
  IndexedDbIdentityMismatch,
  IndexedDbQuotaExceeded,
  IndexedDbUnavailable,
  IndexedDbUpgradeBlocked,
};

export type {
  IndexedDbEntityTable,
  IndexedDbResidualPredicate,
  IndexedDbScan,
  IndexedDbSubsetPlan,
  IndexedDbSubsetRow,
} from "./query";
