import { LiveSessionAttachment } from "@store/contracts";
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
  acquireRoutedSnapshot,
  commitRoutedCommand,
  getRoutedReceipt,
  locateRoutedSnapshotPart,
  makeR2SnapshotObjects,
  mintRoutedLiveTicket,
  pullRoutedTransactions,
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
  SnapshotObjects,
  unimplementedLiveDelivery,
  unimplementedWakePass,
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

const restoreSocketAttachments = (state: Cloudflare.DurableObjectState["Service"]) =>
  Effect.gen(function* () {
    const sockets = yield* state.getWebSockets();
    for (const socket of sockets) {
      const attachment = yield* Effect.try({
        try: () => socket.deserializeAttachment(),
        catch: (cause) => cause,
      }).pipe(Effect.orElseSucceed(() => null));
      const decoded = Schema.decodeUnknownResult(LiveSessionAttachment)(attachment);
      if (Result.isFailure(decoded)) {
        yield* socket.close(1008, "invalid attachment");
      }
    }
  });

export const organizationInventoryObjectInit = Effect.gen(function* () {
  const state = yield* Cloudflare.DurableObjectState;
  yield* SnapshotObjects;

  return Effect.gen(function* () {
    const db = yield* openOrganizationInventoryDatabase(state);
    const gate = yield* Semaphore.make(1);
    yield* restoreSocketAttachments(state);

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
          return runLibraryCommand(() => acquireRoutedSnapshot(db, call.value));
        }),
      mintLiveTicket: (callWire: RoutedLiveTicketCallWire) =>
        Effect.gen(function* () {
          const call = yield* decodeRpcCall(RoutedLiveTicketCall, callWire);
          if (call._tag === "invalid") return unreadableCall();
          return runLibraryCommand(() => mintRoutedLiveTicket(db, call.value));
        }),
      locateSnapshotPart: (callWire: RoutedSnapshotPartCallWire) =>
        Effect.gen(function* () {
          const call = yield* decodeRpcCall(RoutedSnapshotPartCall, callWire);
          if (call._tag === "invalid") return unreadableCall();
          return runLibraryCommand(() => locateRoutedSnapshotPart(db, call.value));
        }),
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (request.headers.upgrade?.toLowerCase() !== "websocket") {
          return HttpServerResponse.empty({ status: 426 });
        }
        const url = Option.getOrUndefined(HttpServerRequest.toURL(request));
        if (!url || url.searchParams.get("nonce") === null) {
          return HttpServerResponse.empty({ status: 400 });
        }
        unimplementedLiveDelivery();
        const [response] = yield* Cloudflare.upgrade();
        return response;
      }),
      alarm: () =>
        gate.withPermits(1)(
          Effect.gen(function* () {
            yield* prearmCommit(state);
            unimplementedWakePass();
          }),
        ),
      webSocketMessage: () => Effect.sync(() => unimplementedLiveDelivery()),
      webSocketClose: () => Effect.void,
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
