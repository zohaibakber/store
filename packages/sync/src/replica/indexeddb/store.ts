import * as IndexedDb from "@effect/platform-browser/IndexedDb";
import * as IndexedDbDatabase from "@effect/platform-browser/IndexedDbDatabase";
import type * as IndexedDbQueryBuilder from "@effect/platform-browser/IndexedDbQueryBuilder";
import {
  compareDecimalSequence,
  CommandReceipt,
  SyncCommandEnvelope,
  type SnapshotId,
  type SnapshotManifest,
  type SnapshotPartPayload,
  type SyncPullResult,
  type SyncSubscription,
  type SyncTransactionGroup,
} from "@store/contracts";
import {
  replicaEntitySchemas,
  type CommandStatus,
  type Committed,
  type ReplicaCommitNotice,
  type ReplicaReadStamp,
} from "@store/contracts/sync/replica-model";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ClaimNextUploadInput, UploadClaim } from "../commands";
import { makeReplicaCommitHub, noticeFromState } from "../commit-hub";
import {
  assertAuthorityHeadNotBehind,
  assertIncarnationMatch,
  decideEnqueue,
  decideReceipt,
  shouldApplyCommitSequence,
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
import type {
  AppliedCursor,
  QueuedCommand,
  ReplicaStoreContract,
  ReplicaStoreError,
  VerifyAuthorityInput,
} from "../store";
import { executeIndexedDbSubset, type IndexedDbSubsetPlan, type IndexedDbSubsetRow } from "./query";
import { ReplicaIndexedDb, type OutboxRow, type ReplicaStateRow } from "./schema";
import {
  activateIndexedDbSnapshot,
  beginIndexedDbSnapshotImport,
  importIndexedDbSnapshotPart,
} from "./snapshot";

export type IndexedDbReplicaIdentity = {
  readonly organizationId: string;
  readonly userId: string;
  readonly replicaId: string;
};

export type MakeIndexedDbReplicaStoreInput = {
  readonly databaseName: string;
  readonly databaseIdentity: string;
  readonly identity: IndexedDbReplicaIdentity;
  readonly indexedDB?: IDBFactory;
  readonly IDBKeyRange?: typeof IDBKeyRange;
};

type QueryBuilder = IndexedDbQueryBuilder.IndexedDbQueryBuilder<
  (typeof ReplicaIndexedDb)["version"]
>;

const ALL_ENTITY_TABLES = [
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
] as const;

const SNAPSHOT_WRITE_TABLES = [
  ...ALL_ENTITY_TABLES,
  "snapshot_imports",
  "snapshot_staged_rows",
] as const;

const decodeEnvelope = Schema.decodeUnknownSync(Schema.fromJsonString(SyncCommandEnvelope));
const encodeEnvelope = Schema.encodeSync(Schema.fromJsonString(SyncCommandEnvelope));
const encodeReceiptJson = Schema.encodeSync(Schema.fromJsonString(CommandReceipt));

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

const sequenceFields = (clientSequence: string) => ({
  clientSequence,
  clientSequenceLength: clientSequence.length,
  clientSequenceDigits: clientSequence,
});

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

const statusPrefix = (status: CommandStatus) => {
  const lower: [CommandStatus] = [status];
  const upper: [CommandStatus, []] = [status, []];
  return { lower, upper };
};

const lowestOutboxRow = (rows: ReadonlyArray<OutboxRow>): OutboxRow | undefined => {
  let lowest: OutboxRow | undefined;
  for (const row of rows) {
    if (!lowest || compareDecimalSequence(row.clientSequence, lowest.clientSequence) < 0) {
      lowest = row;
    }
  }
  return lowest;
};

const DeletedAtFields = Schema.Struct({
  deletedAt: Schema.optionalKey(Schema.Number),
  updatedAt: Schema.optionalKey(Schema.Number),
});

type SoftDeleteSource = typeof DeletedAtFields.Type;

const softDeleteAt = (parsed: SoftDeleteSource, fallback: number): number =>
  parsed.deletedAt ?? parsed.updatedAt ?? fallback;

export type MigratedOutboxFields = {
  readonly operationId: string;
  readonly status: import("@store/contracts/sync/replica-model").CommandStatus;
  readonly attempts: number;
  readonly outcomeUncertain: boolean;
  readonly commitSequence: string | null;
};

export const PendingMigrationCheckpointRecord = Schema.Struct({
  version: Schema.Number,
  exportedCount: Schema.Number,
  importedCount: Schema.Number,
  verified: Schema.Boolean,
});
export type PendingMigrationCheckpointRecord = typeof PendingMigrationCheckpointRecord.Type;

const decodePendingMigrationCheckpoint = Schema.decodeUnknownOption(
  Schema.fromJsonString(PendingMigrationCheckpointRecord),
);
const encodePendingMigrationCheckpoint = Schema.encodeSync(
  Schema.fromJsonString(PendingMigrationCheckpointRecord),
);

export type IndexedDbReplicaStore = ReplicaStoreContract & {
  readonly dispose: () => Effect.Effect<void>;
  readonly querySubset: (
    plan: IndexedDbSubsetPlan,
  ) => Effect.Effect<
    { readonly stamp: ReplicaReadStamp; readonly rows: ReadonlyArray<IndexedDbSubsetRow> },
    ReplicaStoreError
  >;
  readonly listOutboxStatuses: () => Effect.Effect<
    ReadonlyArray<import("@store/contracts/sync/replica-model").CommandStatus>,
    ReplicaStoreError
  >;
  readonly readCommandAllocation: () => Effect.Effect<
    { readonly epoch: string; readonly nextClientSequence: string },
    ReplicaStoreError
  >;
  readonly restoreMigratedOutboxFields: (
    fields: MigratedOutboxFields,
  ) => Effect.Effect<void, ReplicaStoreError>;
  readonly writePendingMigrationCheckpoint: (
    checkpoint: PendingMigrationCheckpointRecord,
  ) => Effect.Effect<void, ReplicaStoreError>;
  readonly readPendingMigrationCheckpoint: () => Effect.Effect<
    PendingMigrationCheckpointRecord | undefined,
    ReplicaStoreError
  >;
};

export const makeIndexedDbReplicaStore = (
  input: MakeIndexedDbReplicaStoreInput,
): Effect.Effect<IndexedDbReplicaStore, ReplicaStoreError> =>
  Effect.gen(function* () {
    const primitives = yield* requirePrimitives(input.indexedDB, input.IDBKeyRange);
    const { publish, commits } = yield* makeReplicaCommitHub();
    const indexedDbLayer = Layer.succeed(IndexedDb.IndexedDb, IndexedDb.make(primitives));
    const runtime = ManagedRuntime.make(
      ReplicaIndexedDb.layer(input.databaseName).pipe(Layer.provide(indexedDbLayer)),
    );

    const runDb = <A>(
      effect: Effect.Effect<A, unknown, IndexedDbDatabase.IndexedDbDatabase>,
    ): Promise<A> =>
      runtime.runPromise(effect).then(
        (value) => value,
        (cause) => {
          throw mapIndexedDbFailure(cause);
        },
      );

    const withQuery = <A>(
      run: (api: QueryBuilder) => Effect.Effect<A, unknown>,
    ): Effect.Effect<A, ReplicaStoreError> =>
      Effect.tryPromise({
        try: () =>
          runDb(
            Effect.gen(function* () {
              const api = yield* ReplicaIndexedDb.getQueryBuilder;
              return yield* run(api);
            }),
          ),
        catch: mapIndexedDbFailure,
      });

    const readState = (api: QueryBuilder) =>
      api
        .from("replica_state")
        .select()
        .equals("singleton")
        .pipe(
          Effect.map((rows): ReplicaStateRow | undefined => {
            const [row] = rows;
            return row;
          }),
        );

    yield* withQuery((api) =>
      Effect.gen(function* () {
        const existing = yield* readState(api);
        if (!existing) {
          yield* api.withTransaction({
            tables: ["replica_state"],
            mode: "readwrite",
            durability: "strict",
          })(
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

    const stampOf = (state: {
      activeGeneration: number;
      localCommitVersion: number;
    }): ReplicaReadStamp => ({
      generationId: String(state.activeGeneration),
      localCommitVersion: state.localCommitVersion,
    });

    const visibleStock = (api: QueryBuilder, generation: number, batchId: string) =>
      Effect.gen(function* () {
        const batches = yield* api.from("batches").select().equals([generation, batchId]);
        const batch = batches[0];
        const overlays = yield* api.from("stock_overlays").select("byBatch").equals(batchId);
        return {
          packQuantity:
            (batch?.packQuantity ?? 0) + overlays.reduce((sum, row) => sum + row.packDelta, 0),
          unitQuantity:
            (batch?.unitQuantity ?? 0) + overlays.reduce((sum, row) => sum + row.unitDelta, 0),
        };
      });

    const enqueueCommand = Effect.fn("IndexedDbReplicaStore.enqueueCommand")(function* (
      envelope: SyncCommandEnvelope,
      createdAt: number,
    ) {
      const committed = yield* withQuery((api) =>
        api.withTransaction({
          tables: ["replica_state", "command_outbox", "stock_overlays", "products", "batches"],
          mode: "readwrite",
          durability: "strict",
        })(
          Effect.gen(function* () {
            const state = yield* readState(api);
            if (!state) {
              return yield* Effect.fail(
                ReplicaStorageError.make({ message: "Replica state is missing." }),
              );
            }
            const before = stampOf(state);
            const existingRows = yield* api
              .from("command_outbox")
              .select()
              .equals(envelope.operationId);
            const existing = existingRows[0];
            let existingEnvelope: SyncCommandEnvelope | undefined;
            if (existing) {
              try {
                existingEnvelope = decodeEnvelope(existing.envelopeJson);
              } catch (cause) {
                return yield* Effect.fail(
                  IndexedDbCorruptRecord.make({
                    message: cause instanceof Error ? cause.message : "Corrupt outbox envelope.",
                    store: "command_outbox",
                  }),
                );
              }
            }

            const packCache = new Map<string, number>();
            const stockCache = new Map<string, { packQuantity: number; unitQuantity: number }>();
            if (envelope.command._tag === "issueInvoice" && !existing) {
              for (const take of envelope.command.payload.allocations) {
                if (!packCache.has(take.productId)) {
                  const products = yield* api
                    .from("products")
                    .select()
                    .equals([state.activeGeneration, take.productId]);
                  packCache.set(take.productId, products[0]?.unitsPerPack ?? 1);
                }
                if (!stockCache.has(take.batchId)) {
                  stockCache.set(
                    take.batchId,
                    yield* visibleStock(api, state.activeGeneration, take.batchId),
                  );
                }
              }
            }

            const decision = decideEnqueue(
              {
                organizationId: state.organizationId,
                epoch: state.epoch,
                replicaId: state.replicaId,
                nextClientSequence: state.nextClientSequence,
              },
              existing && existingEnvelope
                ? { status: existing.status, envelope: existingEnvelope }
                : undefined,
              envelope,
              (productId) => packCache.get(productId) ?? 1,
              (batchId) => stockCache.get(batchId) ?? { packQuantity: 0, unitQuantity: 0 },
            );
            if (decision._tag === "replay") {
              return {
                value: { operationId: envelope.operationId, status: decision.status },
                notice: undefined,
                before,
              } satisfies Committed<QueuedCommand> & { before: ReplicaReadStamp };
            }

            for (const overlay of decision.overlays) {
              yield* api.from("stock_overlays").insert(overlay);
            }
            yield* api.from("command_outbox").insert({
              operationId: envelope.operationId,
              status: "pending",
              envelopeJson: encodeEnvelope(envelope),
              receiptJson: null,
              ...sequenceFields(envelope.clientSequence),
              createdAt,
              claimId: null,
              claimedAt: null,
              attempts: 0,
              outcomeUncertain: false,
              commitSequence: null,
            });
            const nextVersion = state.localCommitVersion + 1;
            yield* api.from("replica_state").upsert({
              ...state,
              nextClientSequence: decision.nextClientSequence,
              localCommitVersion: nextVersion,
            });
            const after: ReplicaReadStamp = {
              generationId: String(state.activeGeneration),
              localCommitVersion: nextVersion,
            };
            return {
              value: { operationId: envelope.operationId, status: "pending" as const },
              notice: noticeFromState(
                input.databaseIdentity,
                after,
                ["batch"],
                [],
                [{ operationId: envelope.operationId, status: "pending" }],
              ),
              before,
            };
          }),
        ),
      );
      yield* publish(committed.notice);
      return { value: committed.value, notice: committed.notice };
    });

    const claimNextUploadOp = Effect.fn("IndexedDbReplicaStore.claimNextUpload")(function* (
      claimInput: ClaimNextUploadInput,
    ) {
      const committed = yield* withQuery((api) =>
        api.withTransaction({
          tables: ["replica_state", "command_outbox"],
          mode: "readwrite",
          durability: "strict",
        })(
          Effect.gen(function* () {
            const sendingRange = statusPrefix("sending");
            const sending = yield* api
              .from("command_outbox")
              .select("byStatusSequence")
              .between(sendingRange.lower, sendingRange.upper);
            if (sending.length > 0) {
              return { value: undefined, notice: undefined };
            }
            const pendingRange = statusPrefix("pending");
            const pending = yield* api
              .from("command_outbox")
              .select("byStatusSequence")
              .between(pendingRange.lower, pendingRange.upper);
            const lowest = lowestOutboxRow(pending);
            if (!lowest) return { value: undefined, notice: undefined };
            let envelope: SyncCommandEnvelope;
            try {
              envelope = decodeEnvelope(lowest.envelopeJson);
            } catch (cause) {
              return yield* Effect.fail(
                IndexedDbCorruptRecord.make({
                  message: cause instanceof Error ? cause.message : "Corrupt outbox envelope.",
                  store: "command_outbox",
                }),
              );
            }
            const attempts = lowest.attempts + 1;
            yield* api.from("command_outbox").upsert({
              ...lowest,
              status: "sending",
              claimId: claimInput.claimId,
              claimedAt: claimInput.claimedAt,
              attempts,
            });
            const state = yield* readState(api);
            if (!state) {
              return yield* Effect.fail(
                ReplicaStorageError.make({ message: "Replica state is missing." }),
              );
            }
            const nextVersion = state.localCommitVersion + 1;
            yield* api.from("replica_state").upsert({ ...state, localCommitVersion: nextVersion });
            const claim: UploadClaim = {
              operationId: lowest.operationId,
              claimId: claimInput.claimId,
              claimedAt: claimInput.claimedAt,
              attempts,
              outcomeUncertain: lowest.outcomeUncertain,
              envelope,
            };
            return {
              value: claim,
              notice: noticeFromState(
                input.databaseIdentity,
                {
                  generationId: String(state.activeGeneration),
                  localCommitVersion: nextVersion,
                },
                [],
                [],
                [{ operationId: claim.operationId, status: "sending" }],
              ),
            };
          }),
        ),
      );
      yield* publish(committed.notice);
      return committed;
    });

    const settleUploadClaim = Effect.fn("IndexedDbReplicaStore.settleUploadClaim")(function* (
      claimId: string,
      receipt: CommandReceipt,
    ) {
      const committed = yield* withQuery((api) =>
        api.withTransaction({
          tables: ["replica_state", "command_outbox", "stock_overlays"],
          mode: "readwrite",
          durability: "strict",
        })(
          Effect.gen(function* () {
            const rows = yield* api.from("command_outbox").select().equals(receipt.operationId);
            const row = rows[0];
            if (!row) return { value: undefined, notice: undefined };
            let envelope: SyncCommandEnvelope;
            try {
              envelope = decodeEnvelope(row.envelopeJson);
            } catch (cause) {
              return yield* Effect.fail(
                IndexedDbCorruptRecord.make({
                  message: cause instanceof Error ? cause.message : "Corrupt outbox envelope.",
                  store: "command_outbox",
                }),
              );
            }
            const claimMatches = row.status === "sending" && row.claimId === claimId;
            const decision = decideReceipt(row.status, envelope, receipt, claimMatches);
            if (decision._tag === "noop") return { value: decision.status, notice: undefined };
            const state = yield* readState(api);
            if (!state) {
              return yield* Effect.fail(
                ReplicaStorageError.make({ message: "Replica state is missing." }),
              );
            }
            let nextStatus: CommandStatus = decision.status;
            if (decision._tag === "rejected") {
              yield* api.from("stock_overlays").delete("byCommand").equals(receipt.operationId);
              yield* api.from("command_outbox").upsert({
                ...row,
                status: "rejected",
                receiptJson: encodeReceiptJson(receipt),
                commitSequence: receipt.commitSequence,
                claimId: null,
                claimedAt: null,
                outcomeUncertain: false,
              });
              nextStatus = "rejected";
            } else if (decision._tag === "refreshIntegrated") {
              yield* api.from("command_outbox").upsert({
                ...row,
                receiptJson: encodeReceiptJson(receipt),
                commitSequence: receipt.commitSequence,
                claimId: null,
                claimedAt: null,
                outcomeUncertain: false,
              });
              return { value: "integrated" as const, notice: undefined };
            } else {
              yield* api.from("command_outbox").upsert({
                ...row,
                status: "accepted_awaiting_integration",
                receiptJson: encodeReceiptJson(receipt),
                commitSequence: receipt.commitSequence,
                claimId: null,
                claimedAt: null,
                outcomeUncertain: false,
              });
              nextStatus = "accepted_awaiting_integration";
            }
            const nextVersion = state.localCommitVersion + 1;
            yield* api.from("replica_state").upsert({ ...state, localCommitVersion: nextVersion });
            return {
              value: nextStatus,
              notice: noticeFromState(
                input.databaseIdentity,
                {
                  generationId: String(state.activeGeneration),
                  localCommitVersion: nextVersion,
                },
                ["batch"],
                [],
                [{ operationId: receipt.operationId, status: nextStatus }],
              ),
            };
          }),
        ),
      );
      yield* publish(committed.notice);
      return committed;
    });

    const releaseUploadClaim = Effect.fn("IndexedDbReplicaStore.releaseUploadClaim")(function* (
      operationId: string,
      claimId: string,
    ) {
      const committed = yield* withQuery((api) =>
        api.withTransaction({
          tables: ["replica_state", "command_outbox"],
          mode: "readwrite",
          durability: "strict",
        })(
          Effect.gen(function* () {
            const rows = yield* api.from("command_outbox").select().equals(operationId);
            const row = rows[0];
            if (!row || row.status !== "sending" || row.claimId !== claimId) {
              return { value: row?.status, notice: undefined };
            }
            const state = yield* readState(api);
            if (!state) {
              return yield* Effect.fail(
                ReplicaStorageError.make({ message: "Replica state is missing." }),
              );
            }
            yield* api.from("command_outbox").upsert({
              ...row,
              status: "pending",
              claimId: null,
              claimedAt: null,
              outcomeUncertain: true,
            });
            const nextVersion = state.localCommitVersion + 1;
            yield* api.from("replica_state").upsert({ ...state, localCommitVersion: nextVersion });
            return {
              value: "pending" as const,
              notice: noticeFromState(
                input.databaseIdentity,
                {
                  generationId: String(state.activeGeneration),
                  localCommitVersion: nextVersion,
                },
                [],
                [],
                [{ operationId, status: "pending" }],
              ),
            };
          }),
        ),
      );
      yield* publish(committed.notice);
      return committed;
    });

    const recoverStaleUploadClaims = Effect.fn("IndexedDbReplicaStore.recoverStaleUploadClaims")(
      function* (staleBefore: number) {
        const committed = yield* withQuery((api) =>
          api.withTransaction({
            tables: ["replica_state", "command_outbox"],
            mode: "readwrite",
            durability: "strict",
          })(
            Effect.gen(function* () {
              const sendingRange = statusPrefix("sending");
              const sending = yield* api
                .from("command_outbox")
                .select("byStatusSequence")
                .between(sendingRange.lower, sendingRange.upper);
              const stale = sending.filter(
                (row) => row.claimedAt === null || row.claimedAt <= staleBefore,
              );
              if (stale.length === 0) return { value: 0, notice: undefined };
              for (const row of stale) {
                yield* api.from("command_outbox").upsert({
                  ...row,
                  status: "pending",
                  claimId: null,
                  claimedAt: null,
                  outcomeUncertain: true,
                });
              }
              const state = yield* readState(api);
              if (!state) {
                return yield* Effect.fail(
                  ReplicaStorageError.make({ message: "Replica state is missing." }),
                );
              }
              const nextVersion = state.localCommitVersion + 1;
              yield* api
                .from("replica_state")
                .upsert({ ...state, localCommitVersion: nextVersion });
              return {
                value: stale.length,
                notice: noticeFromState(input.databaseIdentity, {
                  generationId: String(state.activeGeneration),
                  localCommitVersion: nextVersion,
                }),
              };
            }),
          ),
        );
        yield* publish(committed.notice);
        return committed;
      },
    );

    const applyEntityChange = (
      api: QueryBuilder,
      generation: number,
      change: SyncTransactionGroup["changes"][number],
    ): Effect.Effect<void, unknown> => {
      if (change.action === "delete" && change.entity === "stockMovement") {
        return api.from("stock_movements").delete().equals([generation, change.entityId]);
      }

      switch (change.entity) {
        case "category": {
          const parsed = Schema.decodeUnknownSync(replicaEntitySchemas.category)(change.row);
          const deletedAt =
            change.action === "delete"
              ? softDeleteAt(
                  Schema.decodeUnknownOption(DeletedAtFields)(parsed).pipe(
                    Option.getOrElse(() => ({})),
                  ),
                  Date.now(),
                )
              : parsed.deletedAt;
          return api.from("categories").upsert({
            generation,
            ...parsed,
            deletedAt,
          });
        }
        case "product": {
          const parsed = Schema.decodeUnknownSync(replicaEntitySchemas.product)(change.row);
          const deletedAt =
            change.action === "delete"
              ? softDeleteAt(
                  Schema.decodeUnknownOption(DeletedAtFields)(parsed).pipe(
                    Option.getOrElse(() => ({})),
                  ),
                  Date.now(),
                )
              : parsed.deletedAt;
          return api.from("products").upsert({
            generation,
            ...parsed,
            deletedAt,
          });
        }
        case "batch": {
          const parsed = Schema.decodeUnknownSync(replicaEntitySchemas.batch)(change.row);
          const deletedAt =
            change.action === "delete"
              ? softDeleteAt(
                  Schema.decodeUnknownOption(DeletedAtFields)(parsed).pipe(
                    Option.getOrElse(() => ({})),
                  ),
                  Date.now(),
                )
              : parsed.deletedAt;
          return api.from("batches").upsert({
            generation,
            ...parsed,
            deletedAt,
          });
        }
        case "invoice": {
          const parsed = Schema.decodeUnknownSync(replicaEntitySchemas.invoice)(change.row);
          const deletedAt =
            change.action === "delete"
              ? softDeleteAt(
                  Schema.decodeUnknownOption(DeletedAtFields)(parsed).pipe(
                    Option.getOrElse(() => ({})),
                  ),
                  Date.now(),
                )
              : parsed.deletedAt;
          return api.from("invoices").upsert({
            generation,
            ...parsed,
            deletedAt,
          });
        }
        case "invoiceItem": {
          const parsed = Schema.decodeUnknownSync(replicaEntitySchemas.invoiceItem)(change.row);
          const deletedAt =
            change.action === "delete"
              ? softDeleteAt(
                  Schema.decodeUnknownOption(DeletedAtFields)(parsed).pipe(
                    Option.getOrElse(() => ({})),
                  ),
                  Date.now(),
                )
              : parsed.deletedAt;
          return api.from("invoice_items").upsert({
            generation,
            ...parsed,
            deletedAt,
          });
        }
        case "stockMovement": {
          const parsed = Schema.decodeUnknownSync(replicaEntitySchemas.stockMovement)(change.row);
          return api.from("stock_movements").upsert({
            generation,
            ...parsed,
          });
        }
        default: {
          const _exhaustive: never = change.entity;
          return Effect.die(_exhaustive);
        }
      }
    };

    const applyTransactionGroup = Effect.fn("IndexedDbReplicaStore.applyTransactionGroup")(
      function* (group: SyncTransactionGroup) {
        const committed = yield* withQuery((api) =>
          api.withTransaction({
            tables: [...ALL_ENTITY_TABLES],
            mode: "readwrite",
            durability: "strict",
          })(
            Effect.gen(function* () {
              const state = yield* readState(api);
              if (!state) {
                return yield* Effect.fail(
                  ReplicaStorageError.make({ message: "Replica state is missing." }),
                );
              }
              if (!shouldApplyCommitSequence(state.appliedCommitSequence, group.commitSequence)) {
                return {
                  value: state.appliedCommitSequence,
                  notice: undefined,
                };
              }
              for (const change of group.changes) {
                yield* applyEntityChange(api, state.activeGeneration, change);
              }
              yield* api.from("stock_overlays").delete("byCommand").equals(group.operationId);
              const outbox = yield* api.from("command_outbox").select().equals(group.operationId);
              if (outbox[0] && outbox[0].status !== "rejected") {
                yield* api.from("command_outbox").upsert({
                  ...outbox[0],
                  status: "integrated",
                });
              }
              const nextVersion = state.localCommitVersion + 1;
              yield* api.from("replica_state").upsert({
                ...state,
                appliedCommitSequence: group.commitSequence,
                localCommitVersion: nextVersion,
              });
              return {
                value: group.commitSequence,
                notice: noticeFromState(
                  input.databaseIdentity,
                  {
                    generationId: String(state.activeGeneration),
                    localCommitVersion: nextVersion,
                  },
                  ["category", "product", "batch", "invoice", "invoiceItem", "stockMovement"],
                ),
              };
            }),
          ),
        );
        yield* publish(committed.notice);
        return committed;
      },
    );

    const applyRemotePage = Effect.fn("IndexedDbReplicaStore.applyRemotePage")(function* (
      page: SyncPullResult,
    ) {
      const baseline = yield* withQuery((api) =>
        Effect.gen(function* () {
          const state = yield* readState(api);
          if (!state) {
            return yield* Effect.fail(
              ReplicaStorageError.make({ message: "Replica state is missing." }),
            );
          }
          yield* Effect.try({
            try: () => assertIncarnationMatch(state.incarnation, page.incarnation),
            catch: mapIndexedDbFailure,
          });
          return state.appliedCommitSequence;
        }),
      );
      let appliedThrough = baseline;
      let repairRequired = false;
      let lastNotice: ReplicaCommitNotice | undefined;
      for (const group of page.transactions) {
        const applied = yield* applyTransactionGroup(group);
        appliedThrough = applied.value;
        lastNotice = applied.notice ?? lastNotice;
      }
      yield* withQuery((api) =>
        Effect.gen(function* () {
          const rows = yield* api.from("replica_coverage").select().equals(page.subscription);
          if (!rows[0]) {
            yield* api.withTransaction({
              tables: ["replica_coverage"],
              mode: "readwrite",
              durability: "strict",
            })(
              api.from("replica_coverage").insert({
                subscription: page.subscription,
                state: "downloaded",
                throughCommitSequence: appliedThrough,
                digest: null,
              }),
            );
          }
        }),
      );
      const result: Committed<AppliedCursor> = {
        value: { appliedThrough, repairRequired },
        notice: lastNotice,
      };
      return result;
    });

    const PENDING_MIGRATION_CHECKPOINT_SUBSCRIPTION = "__pending_migration_v1__";

    const listOutboxStatuses = () =>
      withQuery((api) =>
        api
          .from("command_outbox")
          .select()
          .pipe(Effect.map((rows) => rows.map((row) => row.status))),
      );

    const readCommandAllocation = () =>
      withQuery((api) =>
        readState(api).pipe(
          Effect.flatMap((state) =>
            state
              ? Effect.succeed({
                  epoch: state.epoch,
                  nextClientSequence: state.nextClientSequence,
                })
              : Effect.fail(ReplicaStorageError.make({ message: "Replica state is missing." })),
          ),
        ),
      );

    const readSyncCursor = () =>
      withQuery((api) =>
        readState(api).pipe(
          Effect.flatMap((state) =>
            state
              ? Effect.succeed({
                  epoch: state.epoch,
                  appliedCommitSequence: state.appliedCommitSequence,
                })
              : Effect.fail(ReplicaStorageError.make({ message: "Replica state is missing." })),
          ),
        ),
      );

    const restoreMigratedOutboxFields = (fields: MigratedOutboxFields) =>
      withQuery((api) =>
        api.withTransaction({
          tables: ["command_outbox"],
          mode: "readwrite",
          durability: "strict",
        })(
          Effect.gen(function* () {
            const rows = yield* api.from("command_outbox").select().equals(fields.operationId);
            const existing = rows[0];
            if (!existing) {
              return yield* Effect.fail(
                ReplicaStorageError.make({
                  message: `Migrated outbox row ${fields.operationId} is missing.`,
                }),
              );
            }
            yield* api.from("command_outbox").upsert({
              ...existing,
              status: fields.status,
              attempts: fields.attempts,
              outcomeUncertain: fields.outcomeUncertain,
              commitSequence: fields.commitSequence,
            });
          }),
        ),
      );

    const writePendingMigrationCheckpoint = (checkpoint: PendingMigrationCheckpointRecord) =>
      withQuery((api) =>
        api.withTransaction({
          tables: ["replica_coverage"],
          mode: "readwrite",
          durability: "strict",
        })(
          api.from("replica_coverage").upsert({
            subscription: PENDING_MIGRATION_CHECKPOINT_SUBSCRIPTION,
            state: "downloaded",
            throughCommitSequence: String(checkpoint.importedCount),
            digest: encodePendingMigrationCheckpoint(checkpoint),
          }),
        ),
      );

    const readPendingMigrationCheckpoint = () =>
      withQuery((api) =>
        Effect.gen(function* () {
          const rows = yield* api
            .from("replica_coverage")
            .select()
            .equals(PENDING_MIGRATION_CHECKPOINT_SUBSCRIPTION);
          const digest = rows[0]?.digest;
          if (!digest) return undefined;
          return Option.getOrUndefined(decodePendingMigrationCheckpoint(digest));
        }),
      );

    const beginSnapshotImport = Effect.fn("IndexedDbReplicaStore.beginSnapshotImport")(function* (
      manifest: SnapshotManifest,
    ) {
      yield* withQuery((api) =>
        api.withTransaction({
          tables: ["replica_state", "snapshot_imports"],
          mode: "readwrite",
          durability: "strict",
        })(
          Effect.gen(function* () {
            const state = yield* readState(api);
            if (!state) {
              return yield* Effect.fail(
                ReplicaStorageError.make({ message: "Replica state is missing." }),
              );
            }
            yield* beginIndexedDbSnapshotImport(api, state.activeGeneration, manifest);
          }),
        ),
      );
    });

    const importSnapshotPart = Effect.fn("IndexedDbReplicaStore.importSnapshotPart")(function* (
      manifest: SnapshotManifest,
      part: SnapshotPartPayload,
    ) {
      yield* withQuery((api) =>
        api.withTransaction({
          tables: ["snapshot_imports", "snapshot_staged_rows"],
          mode: "readwrite",
          durability: "strict",
        })(importIndexedDbSnapshotPart(api, manifest, part)),
      );
    });

    const activateSnapshot = Effect.fn("IndexedDbReplicaStore.activateSnapshot")(function* (
      snapshotId: SnapshotId,
    ) {
      const committed = yield* withQuery((api) =>
        api.withTransaction({
          tables: [...SNAPSHOT_WRITE_TABLES],
          mode: "readwrite",
          durability: "strict",
        })(
          Effect.gen(function* () {
            const activated = yield* activateIndexedDbSnapshot(api, snapshotId);
            return {
              value: undefined,
              notice: noticeFromState(
                input.databaseIdentity,
                {
                  generationId: String(activated.activeGeneration),
                  localCommitVersion: activated.localCommitVersion,
                },
                ["category", "product", "batch", "invoice", "invoiceItem", "stockMovement"],
              ),
            };
          }),
        ),
      );
      yield* publish(committed.notice);
      return committed;
    });

    const verifyAuthority = Effect.fn("IndexedDbReplicaStore.verifyAuthority")(function* (
      authority: VerifyAuthorityInput,
    ) {
      yield* withQuery((api) =>
        Effect.gen(function* () {
          const state = yield* readState(api);
          if (!state) {
            return yield* Effect.fail(
              ReplicaStorageError.make({ message: "Replica state is missing." }),
            );
          }
          yield* Effect.try({
            try: () => {
              assertIncarnationMatch(state.incarnation, authority.incarnation);
              assertAuthorityHeadNotBehind(state.appliedCommitSequence, authority.horizon);
            },
            catch: mapIndexedDbFailure,
          });
        }),
      );
    });

    const markCoverageRepair = Effect.fn("IndexedDbReplicaStore.markCoverageRepair")(function* (
      subscription: SyncSubscription,
    ) {
      yield* withQuery((api) =>
        api.withTransaction({
          tables: ["replica_coverage"],
          mode: "readwrite",
          durability: "strict",
        })(
          api.from("replica_coverage").upsert({
            subscription,
            state: "awaiting_snapshot",
            throughCommitSequence: null,
            digest: null,
          }),
        ),
      );
    });

    return {
      readSyncCursor,
      enqueueCommand,
      claimNextUpload: claimNextUploadOp,
      settleUploadClaim,
      releaseUploadClaim,
      recoverStaleUploadClaims,
      applyRemotePage,
      applyTransactionGroup,
      beginSnapshotImport,
      importSnapshotPart,
      activateSnapshot,
      verifyAuthority,
      markCoverageRepair,
      readCommandStatus: (operationId) =>
        withQuery((api) =>
          api
            .from("command_outbox")
            .select()
            .equals(operationId)
            .pipe(Effect.map((rows) => rows[0]?.status)),
        ),
      listOutboxStatuses,
      readCommandAllocation,
      restoreMigratedOutboxFields,
      writePendingMigrationCheckpoint,
      readPendingMigrationCheckpoint,
      readStamp: () =>
        withQuery((api) =>
          readState(api).pipe(
            Effect.flatMap((state) =>
              state
                ? Effect.succeed(stampOf(state))
                : Effect.fail(ReplicaStorageError.make({ message: "Replica state is missing." })),
            ),
          ),
        ),
      querySubset: (plan: IndexedDbSubsetPlan) =>
        withQuery((api) =>
          api.withTransaction({
            tables: [plan.table, "replica_state"],
            mode: "readonly",
            durability: "strict",
          })(
            Effect.gen(function* () {
              const state = yield* readState(api);
              if (!state) {
                return yield* Effect.fail(
                  ReplicaStorageError.make({ message: "Replica state is missing." }),
                );
              }
              const rows = yield* executeIndexedDbSubset(api, state.activeGeneration, plan);
              return {
                stamp: stampOf(state),
                rows,
              } satisfies {
                readonly stamp: ReplicaReadStamp;
                readonly rows: ReadonlyArray<IndexedDbSubsetRow>;
              };
            }),
          ),
        ),
      commits,
      dispose: () => runtime.disposeEffect,
    } satisfies IndexedDbReplicaStore;
  });

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
