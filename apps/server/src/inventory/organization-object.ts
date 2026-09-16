import {
  LiveSessionAttachment,
  LiveTicketNonce,
  MAX_SYNC_IDENTIFIER_LENGTH,
  SyncLiveServerFrame,
  SyncProtocolError,
  SyncSubscription,
} from "@store/contracts";
import { inventoryMigrations } from "@store/db/inventory/migrations";
import * as Cloudflare from "alchemy/Cloudflare";
import { drizzle } from "drizzle-orm/durable-sqlite";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import {
  runMigrations,
  type SqliteMigrationTarget,
} from "../../../../packages/sync/src/migrations";
import { runSqliteTransaction } from "../../../../packages/sync/src/sqlite";
import {
  acceptLiveUpgrade,
  acquireRoutedSnapshot,
  closeLiveUpgrade,
  commitRoutedCommand,
  completeWakePass,
  createLiveTicketNonce,
  encodeLiveServerFrame,
  encodeSnapshotUpload,
  getRoutedReceipt,
  handleLiveClientMessage,
  liveUpgradeErrorStatus,
  loadStoredInventoryIdentity,
  locateRoutedSnapshotPart,
  makeR2SnapshotObjects,
  mintRoutedLiveTicket,
  prepareWakePass,
  pullRoutedTransactions,
  recordWakeDelivery,
  registerRoutedReplica,
  RoutedCommandCall,
  RoutedLiveTicketCall,
  RoutedPullCall,
  RoutedReceiptCall,
  RoutedReplicaCall,
  RoutedSnapshotCall,
  RoutedSnapshotPartCall,
  rpcProtocolFailure,
  runLibraryCommand,
  settleWakeUpload,
  SnapshotObjects,
  type InventoryTransactionHost,
  type OrganizationInventoryRpc,
  type RoutedCommandCallWire,
  type RoutedLiveTicketCallWire,
  type RoutedPullCallWire,
  type RoutedReceiptCallWire,
  type RoutedReplicaCallWire,
  type RoutedSnapshotCallWire,
  type RoutedSnapshotPartCallWire,
  type RpcReply,
} from "./organization-host";

export class OrganizationInventoryObject extends Cloudflare.DurableObject<
  OrganizationInventoryObject,
  OrganizationInventoryRpc
>()("OrganizationInventoryObject") {}

const MigrationKeyRow = Schema.Struct({
  key: Schema.String,
});

const LiveUpgradeQuery = Schema.Struct({
  nonce: LiveTicketNonce,
  replicaId: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_SYNC_IDENTIFIER_LENGTH),
  ),
  subscription: SyncSubscription,
  userId: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_SYNC_IDENTIFIER_LENGTH),
  ),
  authorizationExpiresAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
});

const durableSqliteMigrationTarget = (storage: DurableObjectStorage): SqliteMigrationTarget => ({
  execute: (sql, parameters) => {
    storage.sql.exec(sql, ...parameters);
  },
  appliedKeys: (sql) => {
    const keys: Array<string> = [];
    for (const row of storage.sql.exec(sql)) {
      keys.push(Schema.decodeUnknownSync(MigrationKeyRow)(row).key);
    }
    return keys;
  },
});

export const openOrganizationInventoryDatabase = (
  state: Cloudflare.DurableObjectState["Service"],
): Effect.Effect<InventoryTransactionHost> =>
  Effect.sync(() => {
    const storage = state.raw.storage;
    runMigrations(inventoryMigrations, durableSqliteMigrationTarget(storage));
    const db = drizzle(storage);
    return {
      transaction: (run) => runSqliteTransaction(db, run),
    };
  });

const unreadableCall = <Value>(): RpcReply<Value> =>
  rpcProtocolFailure("INVALID_OPERATION", "The inventory call was unreadable.");

const decodeRpcCall = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: S["Encoded"],
): Effect.Effect<RoutedRpcCallResult<S["Type"]>> =>
  Effect.sync((): RoutedRpcCallResult<S["Type"]> => {
    const decoded = Schema.decodeUnknownResult(schema)(input);
    if (Result.isFailure(decoded)) return { _tag: "invalid" };
    return { _tag: "ok", value: decoded.success };
  });

type RoutedRpcCallResult<A> =
  | { readonly _tag: "ok"; readonly value: A }
  | { readonly _tag: "invalid" };

const prearmCommit = (state: Cloudflare.DurableObjectState["Service"]) =>
  Effect.gen(function* () {
    const existing = yield* state.storage.getAlarm();
    const now = yield* Clock.currentTimeMillis;
    const immediate = now + 1;
    if (existing !== null && existing <= immediate) return;
    yield* state.storage.setAlarm(immediate);
  });

const utf8Text = new TextDecoder();
const isSyncProtocolError = Schema.is(SyncProtocolError);

const socketMessageText = (message: string | ArrayBuffer): string => {
  if (message instanceof ArrayBuffer) return utf8Text.decode(message);
  return message;
};

const readLiveAttachment = (socket: Cloudflare.WebSocket): LiveSessionAttachment | undefined => {
  try {
    const raw = socket.deserializeAttachment();
    const decoded = Schema.decodeUnknownResult(LiveSessionAttachment)(raw);
    if (Result.isFailure(decoded)) return undefined;
    return decoded.success;
  } catch {
    return undefined;
  }
};

const sendFrameToSession = (
  sockets: ReadonlyArray<Cloudflare.WebSocket>,
  sessionId: string,
  frame: SyncLiveServerFrame,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const encoded = encodeLiveServerFrame(frame);
    for (const socket of sockets) {
      const attachment = readLiveAttachment(socket);
      if (!attachment || attachment.replicaId !== sessionId) continue;
      yield* socket.send(encoded);
      return true;
    }
    return false;
  });

const restoreSocketAttachments = (
  state: Cloudflare.DurableObjectState["Service"],
  db: InventoryTransactionHost,
) =>
  Effect.gen(function* () {
    const sockets = yield* state.getWebSockets();
    const identity = db.transaction((tx) => loadStoredInventoryIdentity(tx));
    for (const socket of sockets) {
      const attachment = readLiveAttachment(socket);
      if (attachment === undefined) {
        yield* socket.close(1008, "invalid attachment");
        continue;
      }
      if (!identity || identity._tag !== "ready") {
        yield* socket.close(1008, "invalid attachment");
        continue;
      }
      yield* socket.send(
        encodeLiveServerFrame({
          _tag: "resume",
          epoch: identity.epoch,
          reason: "send_window_lost",
          fromCommitSequence: attachment.acknowledgedCommitSequence,
        }),
      );
    }
  });

export const organizationInventoryObjectInit = Effect.gen(function* () {
  const state = yield* Cloudflare.DurableObjectState;
  const snapshots = yield* SnapshotObjects;

  return Effect.gen(function* () {
    const db = yield* openOrganizationInventoryDatabase(state);
    const gate = yield* Semaphore.make(1);
    yield* restoreSocketAttachments(state, db);

    const withWake = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      gate.withPermits(1)(
        Effect.gen(function* () {
          yield* prearmCommit(state);
          return yield* effect;
        }),
      );

    return {
      registerReplica: (callWire: RoutedReplicaCallWire) =>
        Effect.gen(function* () {
          const call = yield* decodeRpcCall(RoutedReplicaCall, callWire);
          if (call._tag === "invalid") return unreadableCall();
          const now = yield* Clock.currentTimeMillis;
          return runLibraryCommand(() => registerRoutedReplica(db, call.value, now));
        }),
      submitCommand: (callWire: RoutedCommandCallWire) =>
        Effect.gen(function* () {
          const call = yield* decodeRpcCall(RoutedCommandCall, callWire);
          if (call._tag === "invalid") return unreadableCall();
          const receivedAt = yield* Clock.currentTimeMillis;
          return yield* withWake(
            Effect.sync(() =>
              runLibraryCommand(() => commitRoutedCommand(db, call.value, receivedAt)),
            ),
          );
        }),
      getReceipt: (callWire: RoutedReceiptCallWire) =>
        Effect.gen(function* () {
          const call = yield* decodeRpcCall(RoutedReceiptCall, callWire);
          if (call._tag === "invalid") return unreadableCall();
          return runLibraryCommand(() => getRoutedReceipt(db, call.value));
        }),
      pull: (callWire: RoutedPullCallWire) =>
        Effect.gen(function* () {
          const call = yield* decodeRpcCall(RoutedPullCall, callWire);
          if (call._tag === "invalid") return unreadableCall();
          return runLibraryCommand(() => pullRoutedTransactions(db, call.value));
        }),
      acquireSnapshot: (callWire: RoutedSnapshotCallWire) =>
        Effect.gen(function* () {
          const call = yield* decodeRpcCall(RoutedSnapshotCall, callWire);
          if (call._tag === "invalid") return unreadableCall();
          const now = yield* Clock.currentTimeMillis;
          return yield* withWake(
            Effect.sync(() => runLibraryCommand(() => acquireRoutedSnapshot(db, call.value, now))),
          );
        }),
      mintLiveTicket: (callWire: RoutedLiveTicketCallWire) =>
        Effect.gen(function* () {
          const call = yield* decodeRpcCall(RoutedLiveTicketCall, callWire);
          if (call._tag === "invalid") return unreadableCall();
          const now = yield* Clock.currentTimeMillis;
          const nonce = createLiveTicketNonce();
          return yield* withWake(
            Effect.sync(() =>
              runLibraryCommand(() => mintRoutedLiveTicket(db, call.value, now, nonce)),
            ),
          );
        }),
      locateSnapshotPart: (callWire: RoutedSnapshotPartCallWire) =>
        Effect.gen(function* () {
          const call = yield* decodeRpcCall(RoutedSnapshotPartCall, callWire);
          if (call._tag === "invalid") return unreadableCall();
          return runLibraryCommand(() => locateRoutedSnapshotPart(db, call.value));
        }),
      fetch: withWake(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.headers.upgrade?.toLowerCase() !== "websocket") {
            return HttpServerResponse.empty({ status: 426 });
          }
          const url = Option.getOrUndefined(HttpServerRequest.toURL(request));
          if (!url) return HttpServerResponse.empty({ status: 400 });
          const expiresAt = Number(url.searchParams.get("authorizationExpiresAt"));
          const decoded = Schema.decodeUnknownResult(LiveUpgradeQuery)({
            nonce: url.searchParams.get("nonce"),
            replicaId: url.searchParams.get("replicaId"),
            subscription: url.searchParams.get("subscription"),
            userId: url.searchParams.get("userId"),
            authorizationExpiresAt: expiresAt,
          });
          if (Result.isFailure(decoded)) return HttpServerResponse.empty({ status: 400 });
          const now = yield* Clock.currentTimeMillis;
          const accepted = yield* Effect.sync(() => {
            try {
              return {
                _tag: "accepted" as const,
                attachment: acceptLiveUpgrade(db, {
                  nonce: decoded.success.nonce,
                  replicaId: decoded.success.replicaId,
                  subscription: decoded.success.subscription,
                  userId: decoded.success.userId,
                  authorizationExpiresAt: decoded.success.authorizationExpiresAt,
                  now,
                }),
              };
            } catch (error) {
              if (!isSyncProtocolError(error)) throw error;
              return { _tag: "rejected" as const, error };
            }
          });
          if (accepted._tag === "rejected") {
            return HttpServerResponse.empty({ status: liveUpgradeErrorStatus(accepted.error) });
          }
          const [response, socket] = yield* Cloudflare.upgrade();
          socket.serializeAttachment(accepted.attachment);
          return response;
        }),
      ),
      alarm: () =>
        gate.withPermits(1)(
          Effect.gen(function* () {
            yield* prearmCommit(state);
            const now = yield* Clock.currentTimeMillis;
            const identity = db.transaction((tx) => loadStoredInventoryIdentity(tx));
            if (!identity) return;
            const prepared = prepareWakePass(db, identity.organizationId, now);
            const sockets = yield* state.getWebSockets();
            if (prepared.outbound._tag === "send") {
              const sent = yield* sendFrameToSession(
                sockets,
                prepared.outbound.sessionId,
                prepared.outbound.frame,
              );
              if (sent) {
                recordWakeDelivery(
                  db,
                  identity.organizationId,
                  prepared.outbound.sessionId,
                  prepared.outbound.throughCommitSequence,
                );
              }
            } else if (prepared.outbound._tag === "resume") {
              yield* sendFrameToSession(
                sockets,
                prepared.outbound.sessionId,
                prepared.outbound.frame,
              );
            }
            if (prepared.snapshot._tag === "upload") {
              const bytes = encodeSnapshotUpload(prepared.snapshot);
              if (bytes !== undefined) {
                const uploaded = yield* snapshots
                  .putObject(prepared.snapshot.objectKey, bytes)
                  .pipe(
                    Effect.as(true),
                    Effect.catchTag("SnapshotObjectUnavailable", () => Effect.succeed(false)),
                  );
                if (uploaded) {
                  settleWakeUpload(db, identity.organizationId, prepared.snapshot, now);
                }
              }
            }
            const armed = completeWakePass(db, identity.organizationId, now);
            if (armed.dueAt !== undefined) {
              yield* state.storage.setAlarm(armed.dueAt);
            }
          }),
        ),
      webSocketMessage: (socket, message) =>
        Effect.gen(function* () {
          const attachment = readLiveAttachment(socket);
          if (attachment === undefined) {
            yield* socket.close(1008, "invalid attachment");
            return;
          }
          const now = yield* Clock.currentTimeMillis;
          const outcome = handleLiveClientMessage(db, attachment, socketMessageText(message), now);
          if (outcome._tag === "close") {
            yield* socket.close(1008, "invalid attachment");
            return;
          }
          if (outcome._tag === "resume") {
            yield* socket.send(encodeLiveServerFrame(outcome.frame));
            return;
          }
          socket.serializeAttachment(outcome.attachment);
        }),
      webSocketClose: (socket) =>
        Effect.sync(() => {
          const attachment = readLiveAttachment(socket);
          if (attachment === undefined) return;
          closeLiveUpgrade(db, attachment.organizationId, attachment.replicaId);
        }),
    } satisfies OrganizationInventoryRpc;
  });
});

export const SnapshotObjectsLive = Layer.effect(
  SnapshotObjects,
  Effect.gen(function* () {
    const bucket = yield* Cloudflare.R2.Bucket("InventorySnapshots");
    const client = yield* Cloudflare.R2.ReadWriteBucket(bucket);
    return makeR2SnapshotObjects(client);
  }),
).pipe(Layer.provide(Cloudflare.R2.ReadWriteBucketBinding));

export const OrganizationInventoryObjectLive = OrganizationInventoryObject.make(
  organizationInventoryObjectInit,
).pipe(Layer.provide(SnapshotObjectsLive));
