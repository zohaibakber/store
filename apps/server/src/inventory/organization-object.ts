import { LiveSessionAttachment } from "@store/contracts";
import { inventoryMigrations } from "@store/db/inventory/migrations";
import {
  runMigrations,
  type SqliteMigrationTarget,
} from "../../../../packages/sync/src/migrations";
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
  type RpcReply,
} from "./organization-host";

export class OrganizationInventoryObject extends Cloudflare.DurableObject<OrganizationInventoryObject>()(
  "OrganizationInventoryObject",
) {}

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
    return drizzle(storage);
  });

const unreadableCall = <Value>(): RpcReply<Value> =>
  rpcProtocolFailure("INVALID_OPERATION", "The inventory call was unreadable.");

const decodeRpcCall = <A, I, RD>(schema: Schema.Codec<A, I, RD>, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.map((value) => ({ _tag: "ok" as const, value })),
    Effect.catchTag("SchemaError", () => Effect.succeed({ _tag: "invalid" as const })),
  );

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
      registerReplica: (input: unknown) =>
        Effect.gen(function* () {
          const call = yield* decodeRpcCall(RoutedReplicaCall, input);
          if (call._tag === "invalid") return unreadableCall();
          const now = yield* Clock.currentTimeMillis;
          return runLibraryCommand(() => registerRoutedReplica(db, call.value, now));
        }),
      submitCommand: (input: unknown) =>
        Effect.gen(function* () {
          const call = yield* decodeRpcCall(RoutedCommandCall, input);
          if (call._tag === "invalid") return unreadableCall();
          const receivedAt = yield* Clock.currentTimeMillis;
          return yield* withWake(
            Effect.sync(() => runLibraryCommand(() => commitRoutedCommand(db, call.value, receivedAt))),
          );
        }),
      getReceipt: (input: unknown) =>
        Effect.gen(function* () {
          const call = yield* decodeRpcCall(RoutedReceiptCall, input);
          if (call._tag === "invalid") return unreadableCall();
          return runLibraryCommand(() => getRoutedReceipt(db, call.value));
        }),
      pull: (input: unknown) =>
        Effect.gen(function* () {
          const call = yield* decodeRpcCall(RoutedPullCall, input);
          if (call._tag === "invalid") return unreadableCall();
          return runLibraryCommand(() => pullRoutedTransactions(db, call.value));
        }),
      acquireSnapshot: (input: unknown) =>
        Effect.gen(function* () {
          const call = yield* decodeRpcCall(RoutedSnapshotCall, input);
          if (call._tag === "invalid") return unreadableCall();
          return runLibraryCommand(() => acquireRoutedSnapshot(db, call.value));
        }),
      mintLiveTicket: (input: unknown) =>
        Effect.gen(function* () {
          const call = yield* decodeRpcCall(RoutedLiveTicketCall, input);
          if (call._tag === "invalid") return unreadableCall();
          return runLibraryCommand(() => mintRoutedLiveTicket(db, call.value));
        }),
      locateSnapshotPart: (input: unknown) =>
        Effect.gen(function* () {
          const call = yield* decodeRpcCall(RoutedSnapshotPartCall, input);
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
    };
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
