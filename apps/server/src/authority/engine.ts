import {
  ACTIVE_REPLICA_WINDOW_MILLIS,
  MAX_ORGANIZATION_DEVICES,
  OPERATIONAL_SUBSCRIPTION,
  PARTITION_DIGEST_VERSION,
  staleReplicaRejection,
  SYNC_SCHEMA_VERSION,
  SyncSubmitCommandRequest,
  syncProtocolError,
  type DeviceCommand,
  type RegisterReplicaRequest,
  type SyncCommandEnvelope,
  type SyncLogChange,
  type SyncProtocolCode,
} from "@store/contracts";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  authorityChanges,
  authorityState,
  authorityTransactions,
  commandReceipts,
  replicas,
} from "@store/db/authority.schema";
import {
  constraintViolationOf,
  decideCommandWithin,
  removeEntityRow,
  SETTLED_CATALOG,
  writeEntityRow,
  type ConstraintViolation,
  type Decision,
  type ReplicaDb,
} from "@store/sync/authority";
import { and, asc, between, desc, eq, gt, isNull, or } from "drizzle-orm";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { SqlClient } from "effect/sql/SqlClient";

import { partitionDigest } from "./digest";
import {
  groupByteLength,
  groupFrame,
  pageFrame,
  receiptFrame,
  type StoredChange,
  type StoredReceipt,
} from "./frames";

export type AuthorityActor = {
  readonly organizationId: string;
  readonly userId: string;
};

export class AuthorityRequestMalformed extends Schema.TaggedError<AuthorityRequestMalformed>()(
  "AuthorityRequestMalformed",
  { message: Schema.String },
) {}

export class AuthorityStorageError extends Schema.TaggedError<AuthorityStorageError>()(
  "AuthorityStorageError",
  { message: Schema.String },
) {}

export const PULL_PAGE_GROUPS = 100;

const STATE_ID = 1;

const DAY_MILLIS = 86_400_000;

const CHANGE_ROWS_PER_INSERT = 12;

export const refuse = (code: SyncProtocolCode, message: string) =>
  Effect.fail(syncProtocolError(code, message));

const notReady = () => refuse("EPOCH_MISMATCH", "This organization inventory is not ready.");

export const storageFailure = (cause: unknown) =>
  AuthorityStorageError.make({
    message: cause instanceof Error ? cause.message : "The inventory authority failed.",
  });

export const sequenceOf = (text: string): number => {
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : Number.POSITIVE_INFINITY;
};

const decodeSubmit = Schema.decodeUnknownEffect(Schema.fromJsonString(SyncSubmitCommandRequest));

export type AuthorityState = typeof authorityState.$inferSelect;

export type CommitFanout = {
  readonly epoch: string;
  readonly horizon: string;
  readonly group: string;
  readonly byteLength: number;
  readonly originReplicaId: string;
};

export type EncodedCommit = {
  readonly json: string;
  readonly fanout: CommitFanout | null;
};

const CONSTRAINT_REJECTIONS = {
  duplicate: {
    code: "ENTITY_CONFLICT",
    message: "A record this command creates already exists.",
  },
  value: {
    code: "INVALID_OPERATION",
    message: "A value in this command is out of range.",
  },
} as const satisfies Record<
  ConstraintViolation,
  { readonly code: SyncProtocolCode; readonly message: string }
>;

export const makeAuthorityEngine = (sql: SqlClient, db: ReplicaDb) => {
  const loadState = db
    .select()
    .from(authorityState)
    .where(eq(authorityState.id, STATE_ID))
    .get()
    .pipe(Effect.map((state) => state ?? undefined));

  const requireState = (actor: AuthorityActor) =>
    Effect.flatMap(loadState, (state) =>
      state === undefined || state.organizationId !== actor.organizationId
        ? notReady()
        : Effect.succeed(state),
    );

  const ensureState = Effect.fn("Authority.ensureState")(function* (
    actor: AuthorityActor,
    now: number,
    incarnation: string,
  ) {
    yield* db
      .insert(authorityState)
      .values({
        id: STATE_ID,
        organizationId: actor.organizationId,
        incarnation,
        epoch: "1",
        commitSequence: 0,
        retentionFloor: 0,
        createdAt: now,
      })
      .onConflictDoNothing();
    return yield* requireState(actor);
  });

  const activeReplicas = (now: number) =>
    sql<typeof replicas.$inferSelect>`
      select * from replicas as r
      where r.lastSeenAt >= ${now - ACTIVE_REPLICA_WINDOW_MILLIS}
        and (r.ignoredAt is null or r.ignoredAt < coalesce(r.schemaVersionAt, 0))
        and (r.removedAt is null or r.lastSeenAt > r.removedAt)
        and r.lastSeenAt >= coalesce((
          select min(n.schemaVersionAt) - ${DAY_MILLIS} from replicas as n
          where n.schemaVersion > r.schemaVersion
        ), 0)`;

  const pullWithin = Effect.fn("Authority.pullWithin")(function* (
    state: AuthorityState,
    request: {
      readonly epoch: string;
      readonly subscription: string;
      readonly afterCommitSequence: string;
      readonly maxGroups: number;
      readonly byteBudget: number;
      readonly digestVersion: number | undefined;
    },
  ) {
    if (state.epoch !== request.epoch) {
      return yield* refuse("EPOCH_MISMATCH", "The replica epoch does not match.");
    }
    const after = sequenceOf(request.afterCommitSequence);
    if (after > state.commitSequence) {
      return yield* refuse(
        "SNAPSHOT_REQUIRED",
        "This replica is ahead of the authority and needs recovery.",
      );
    }
    if (after < state.retentionFloor) {
      return yield* refuse(
        "SNAPSHOT_REQUIRED",
        "This replica is behind the retained history and needs a snapshot.",
      );
    }
    const candidates = yield* db
      .select()
      .from(authorityTransactions)
      .where(
        and(
          eq(authorityTransactions.epoch, request.epoch),
          gt(authorityTransactions.commitSequence, after),
        ),
      )
      .orderBy(asc(authorityTransactions.commitSequence))
      .limit(request.maxGroups)
      .all();
    const chosen: typeof candidates = [];
    let used = 0;
    for (const candidate of candidates) {
      used += candidate.byteLength;
      if (chosen.length > 0 && used > request.byteBudget) break;
      chosen.push(candidate);
    }
    const first = chosen[0];
    const last = chosen.at(-1);
    const changes =
      first === undefined || last === undefined
        ? []
        : yield* db
            .select()
            .from(authorityChanges)
            .where(
              between(authorityChanges.commitSequence, first.commitSequence, last.commitSequence),
            )
            .orderBy(asc(authorityChanges.commitSequence), asc(authorityChanges.ordinal))
            .all();
    const byCommit = new Map<number, Array<StoredChange>>();
    for (const change of changes) {
      const held = byCommit.get(change.commitSequence) ?? [];
      held.push(change);
      byCommit.set(change.commitSequence, held);
    }
    const digestJson =
      request.digestVersion === PARTITION_DIGEST_VERSION &&
      (last?.commitSequence ?? after) >= state.commitSequence
        ? JSON.stringify(yield* partitionDigest(db))
        : undefined;
    return pageFrame({
      epoch: state.epoch,
      incarnation: state.incarnation,
      subscription: request.subscription,
      transactions: chosen.map((group) =>
        groupFrame(
          group.commitSequence,
          group.operationId,
          group.decision,
          byCommit.get(group.commitSequence) ?? [],
        ),
      ),
      nextCommitSequence:
        last === undefined ? request.afterCommitSequence : String(last.commitSequence),
      horizon: state.commitSequence,
      retentionFloor: state.retentionFloor,
      digestJson,
    });
  });

  const purchasingGate = Effect.fn("Authority.purchasingGate")(function* (
    envelope: SyncCommandEnvelope,
    now: number,
  ) {
    if (envelope.command._tag !== "catalogWrite") return undefined;
    const touchesPurchasing = envelope.command.payload.writes.some(
      (write) =>
        write.entity === "supplier" ||
        write.entity === "purchaseOrder" ||
        write.entity === "purchaseOrderItem" ||
        (write.entity === "batch" && write.action === "upsert" && write.receipt !== undefined),
    );
    if (!touchesPurchasing) return undefined;
    const stale = (yield* activeReplicas(now))
      .filter((replica) => replica.replicaId !== envelope.replicaId && replica.schemaVersion < 2)
      .sort(
        (left, right) =>
          right.lastSeenAt - left.lastSeenAt || (left.replicaId < right.replicaId ? -1 : 1),
      )[0];
    return stale === undefined ? undefined : staleReplicaRejection(stale.deviceLabel || null);
  });

  const decide = Effect.fn("Authority.decide")(function* (
    actor: AuthorityActor,
    envelope: SyncCommandEnvelope,
    now: number,
  ) {
    if (envelope.command.payload.commandId === envelope.operationId) {
      const gated = yield* purchasingGate(envelope, now);
      if (gated !== undefined) return Result.fail(gated) satisfies Decision;
    }
    return yield* decideCommandWithin(db, actor, envelope, SETTLED_CATALOG);
  });

  const applyAccepted = (organizationId: string, changes: ReadonlyArray<SyncLogChange>) =>
    sql.withTransaction(
      Effect.forEach(
        changes,
        (change) =>
          change.action === "delete"
            ? removeEntityRow(db, organizationId, change.entity, change.entityId)
            : writeEntityRow(db, change.entity, change.row),
        { discard: true },
      ),
    );

  const submitWithin = Effect.fn("Authority.submitWithin")(function* (
    actor: AuthorityActor,
    request: SyncSubmitCommandRequest,
    receivedAt: number,
    pageBytes: number,
  ) {
    if (request.organizationId !== actor.organizationId) {
      return yield* refuse(
        "ORGANIZATION_MISMATCH",
        "The command does not belong to the active organization.",
      );
    }
    if (canonicalPayloadHash(request.command) !== request.payloadHash) {
      return yield* refuse("INVALID_PAYLOAD_HASH", "The payload hash does not match.");
    }
    const state = yield* requireState(actor);
    if (state.epoch !== request.epoch) {
      return yield* refuse("EPOCH_MISMATCH", "The replica epoch does not match.");
    }
    const pageAfter = (after: string) =>
      pullWithin(state, {
        epoch: state.epoch,
        subscription: OPERATIONAL_SUBSCRIPTION,
        afterCommitSequence: after,
        maxGroups: PULL_PAGE_GROUPS,
        byteBudget: pageBytes,
        digestVersion: undefined,
      }).pipe(
        Effect.map((page): string | undefined => page),
        Effect.catchTag("SyncProtocolError", () => Effect.succeed(undefined)),
      );

    const receipted = yield* db
      .select()
      .from(commandReceipts)
      .where(eq(commandReceipts.operationId, request.operationId))
      .get();
    if (receipted !== undefined) {
      if (receipted.payloadHash !== request.payloadHash) {
        return yield* refuse("OPERATION_ID_REUSED", "The command id was reused.");
      }
      return {
        json: receiptFrame(receipted, yield* pageAfter(request.afterCommitSequence)),
        fanout: null,
      } satisfies EncodedCommit;
    }

    const replica = yield* db
      .select()
      .from(replicas)
      .where(eq(replicas.replicaId, request.replicaId))
      .get();
    if (replica === undefined) {
      return yield* refuse("REPLICA_UNKNOWN", "This replica is not registered.");
    }
    if (replica.ownerUserId !== actor.userId) {
      return yield* refuse("REPLICA_OWNED_BY_OTHER", "This replica belongs to another user.");
    }
    const expected = String(replica.lastClientSequence + 1);
    if (request.clientSequence !== expected) {
      return yield* refuse(
        "REPLICA_SEQUENCE_GAP",
        `Expected client sequence ${expected}, received ${request.clientSequence}.`,
      );
    }

    const decision = yield* decide(actor, request, receivedAt);
    const applied = yield* Result.match(decision, {
      onSuccess: ({ result, changes }) =>
        applyAccepted(actor.organizationId, changes).pipe(
          Effect.map(() => Result.succeed({ result, changes })),
          Effect.catch((error) => {
            const violation = constraintViolationOf(error);
            return violation === undefined
              ? Effect.fail(error)
              : Effect.succeed(Result.fail(CONSTRAINT_REJECTIONS[violation]));
          }),
        ),
      onFailure: (rejection) => Effect.succeed(Result.fail(rejection)),
    });

    const commit = state.commitSequence + 1;
    const stored: ReadonlyArray<StoredChange> = Result.isSuccess(applied)
      ? applied.success.changes.map((change) => ({
          entity: change.entity,
          action: change.action,
          entityId: change.entityId,
          rowVersion: change.rowVersion,
          rowJson: JSON.stringify(change.row),
        }))
      : [];
    const decided = Result.isSuccess(applied) ? "accepted" : "rejected";
    const resultJson = Result.isSuccess(applied)
      ? JSON.stringify(applied.success.result)
      : JSON.stringify({
          _tag: "rejected",
          code: applied.failure.code,
          message: applied.failure.message,
        });
    const bytes = groupByteLength(request.operationId, stored);
    const group = groupFrame(commit, request.operationId, decided, stored);

    yield* db
      .update(authorityState)
      .set({ commitSequence: commit })
      .where(eq(authorityState.id, STATE_ID));
    yield* db.insert(authorityTransactions).values({
      commitSequence: commit,
      operationId: request.operationId,
      decision: decided,
      epoch: state.epoch,
      byteLength: bytes,
    });
    yield* Effect.forEach(
      Array.chunksOf(
        stored.map((change, ordinal) => ({ ...change, commitSequence: commit, ordinal })),
        CHANGE_ROWS_PER_INSERT,
      ),
      (rows) => db.insert(authorityChanges).values(rows),
      { discard: true },
    );
    const receipt = {
      operationId: request.operationId,
      replicaId: request.replicaId,
      clientSequence: sequenceOf(request.clientSequence),
      payloadHash: request.payloadHash,
      decision: decided,
      commitSequence: commit,
      resultJson,
    } satisfies StoredReceipt;
    yield* db.insert(commandReceipts).values({ ...receipt, receivedAt, attempts: 1 });
    yield* db
      .update(replicas)
      .set({ lastClientSequence: receipt.clientSequence, lastSeenAt: receivedAt })
      .where(eq(replicas.replicaId, request.replicaId));

    const page =
      sequenceOf(request.afterCommitSequence) === state.commitSequence
        ? bytes <= pageBytes
          ? pageFrame({
              epoch: state.epoch,
              incarnation: state.incarnation,
              subscription: OPERATIONAL_SUBSCRIPTION,
              transactions: [group],
              nextCommitSequence: String(commit),
              horizon: commit,
              retentionFloor: state.retentionFloor,
              digestJson: undefined,
            })
          : undefined
        : yield* pullWithin(
            { ...state, commitSequence: commit },
            {
              epoch: state.epoch,
              subscription: OPERATIONAL_SUBSCRIPTION,
              afterCommitSequence: request.afterCommitSequence,
              maxGroups: PULL_PAGE_GROUPS,
              byteBudget: pageBytes,
              digestVersion: undefined,
            },
          ).pipe(
            Effect.map((frame): string | undefined => frame),
            Effect.catchTag("SyncProtocolError", () => Effect.succeed(undefined)),
          );

    return {
      json: receiptFrame(receipt, page),
      fanout: {
        epoch: state.epoch,
        horizon: String(commit),
        group,
        byteLength: bytes,
        originReplicaId: request.replicaId,
      },
    } satisfies EncodedCommit;
  });

  const listDevices = Effect.fn("Authority.listDevices")(function* (now: number) {
    const active = new Set((yield* activeReplicas(now)).map((replica) => replica.replicaId));
    const rows = yield* db
      .select()
      .from(replicas)
      .where(or(isNull(replicas.removedAt), gt(replicas.lastSeenAt, replicas.removedAt)))
      .orderBy(desc(replicas.lastSeenAt), asc(replicas.replicaId))
      .limit(MAX_ORGANIZATION_DEVICES)
      .all();
    return {
      devices: rows.map((row) => {
        const upToDate = row.schemaVersion >= SYNC_SCHEMA_VERSION;
        return {
          replicaId: row.replicaId,
          userId: row.ownerUserId,
          label: row.deviceLabel || null,
          registeredAt: row.registeredAt,
          lastSeenAt: row.lastSeenAt,
          upToDate,
          ignored: row.ignoredAt !== null && row.ignoredAt >= (row.schemaVersionAt ?? 0),
          holdsBack: active.has(row.replicaId) && !upToDate,
        };
      }),
    };
  });

  const transact = <A, E, R>(effect: Effect.Effect<A, E, R>) => sql.withTransaction(effect);

  return {
    loadState,
    requireState,
    ensureState,
    activeReplicas,
    pullWithin,
    transact,

    register: Effect.fn("Authority.register")(function* (
      actor: AuthorityActor,
      request: RegisterReplicaRequest,
      now: number,
      incarnation: string,
    ) {
      return yield* transact(
        Effect.gen(function* () {
          const state = yield* ensureState(actor, now, incarnation);
          const schemaVersion = request.schemaVersion;
          const existing = yield* db
            .select()
            .from(replicas)
            .where(eq(replicas.replicaId, request.replicaId))
            .get();
          let next: string;
          if (existing !== undefined) {
            if (existing.ownerUserId !== actor.userId) {
              return yield* refuse(
                "REPLICA_OWNED_BY_OTHER",
                "This replica belongs to another user.",
              );
            }
            yield* db
              .update(replicas)
              .set({
                lastSeenAt: now,
                schemaVersion,
                schemaVersionAt:
                  existing.schemaVersion === schemaVersion
                    ? (existing.schemaVersionAt ?? now)
                    : now,
                deviceLabel:
                  request.deviceLabel === undefined ? existing.deviceLabel : request.deviceLabel,
              })
              .where(eq(replicas.replicaId, request.replicaId));
            next = String(existing.lastClientSequence + 1);
          } else {
            yield* db.insert(replicas).values({
              replicaId: request.replicaId,
              ownerUserId: actor.userId,
              deviceLabel: request.deviceLabel ?? null,
              lastClientSequence: 0,
              processedThroughClientSequence: 0,
              registeredAt: now,
              lastSeenAt: now,
              schemaVersion,
              schemaVersionAt: now,
            });
            next = "1";
          }
          const active = yield* activeReplicas(now);
          const lowest = active.reduce<number | undefined>(
            (low, replica) =>
              low === undefined ? replica.schemaVersion : Math.min(low, replica.schemaVersion),
            undefined,
          );
          return {
            replicaId: request.replicaId,
            nextClientSequence: next,
            epoch: state.epoch,
            incarnation: state.incarnation,
            retentionFloor: String(state.retentionFloor),
            horizon: String(state.commitSequence),
            schemaVersion: 1,
            lowestActiveSchemaVersion: lowest ?? schemaVersion,
          };
        }),
      );
    }),

    submit: Effect.fn("Authority.submit")(function* (
      actor: AuthorityActor,
      bodyText: string,
      receivedAt: number,
      pageBytesOf: (maxBytes: number | undefined) => number,
    ) {
      const request = yield* decodeSubmit(bodyText).pipe(
        Effect.mapError(() =>
          AuthorityRequestMalformed.make({
            message: "The command envelope is not valid JSON of the expected shape.",
          }),
        ),
      );
      return yield* transact(
        submitWithin(actor, request, receivedAt, pageBytesOf(request.maxBytes)),
      );
    }),

    receipt: Effect.fn("Authority.receipt")(function* (actor: AuthorityActor, operationId: string) {
      return yield* transact(
        Effect.gen(function* () {
          yield* requireState(actor);
          const row = yield* db
            .select()
            .from(commandReceipts)
            .where(eq(commandReceipts.operationId, operationId))
            .get();
          return row === undefined ? null : receiptFrame(row);
        }),
      );
    }),

    pull: Effect.fn("Authority.pull")(function* (
      actor: AuthorityActor,
      request: {
        readonly epoch: string;
        readonly subscription: string;
        readonly afterCommitSequence: string;
        readonly maxGroups: number;
        readonly byteBudget: number;
        readonly digestVersion: number | undefined;
      },
    ) {
      return yield* transact(
        Effect.flatMap(requireState(actor), (state) => pullWithin(state, request)),
      );
    }),

    devices: Effect.fn("Authority.devices")(function* (actor: AuthorityActor, now: number) {
      return yield* transact(Effect.andThen(requireState(actor), listDevices(now)));
    }),

    deviceCommand: Effect.fn("Authority.deviceCommand")(function* (
      actor: AuthorityActor,
      command: DeviceCommand,
      now: number,
    ) {
      return yield* transact(
        Effect.gen(function* () {
          yield* requireState(actor);
          yield* db
            .update(replicas)
            .set(
              command._tag === "IgnoreDevice"
                ? { ignoredAt: now }
                : command._tag === "HeedDevice"
                  ? { ignoredAt: null }
                  : { removedAt: now },
            )
            .where(eq(replicas.replicaId, command.replicaId));
          return yield* listDevices(now);
        }),
      );
    }),

    liveHorizon: Effect.fn("Authority.liveHorizon")(function* (
      actor: AuthorityActor,
      replicaId: string,
      now: number,
    ) {
      return yield* transact(
        Effect.gen(function* () {
          const state = yield* requireState(actor);
          const replica = yield* db
            .select()
            .from(replicas)
            .where(eq(replicas.replicaId, replicaId))
            .get();
          if (replica === undefined) {
            return yield* refuse("REPLICA_UNKNOWN", "This replica is not registered.");
          }
          if (replica.ownerUserId !== actor.userId) {
            return yield* refuse("REPLICA_OWNED_BY_OTHER", "This replica belongs to another user.");
          }
          yield* db
            .update(replicas)
            .set({ lastSeenAt: now })
            .where(eq(replicas.replicaId, replicaId));
          return { epoch: state.epoch, horizon: String(state.commitSequence) };
        }),
      );
    }),
  };
};

export type AuthorityEngine = ReturnType<typeof makeAuthorityEngine>;
