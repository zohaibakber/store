import {
  AcquireSnapshotRequest,
  AcquireSnapshotResult,
  CommandReceipt,
  InventoryImportId,
  InventoryReleaseId,
  InventoryRoutingContext,
  LiveTicket,
  LiveTicketRequest,
  MAX_SYNC_PULL_TRANSACTIONS,
  OrganizationId,
  RegisterReplicaRequest,
  RegisterReplicaResult,
  SnapshotId,
  SnapshotPartHash,
  SyncCommandEnvelope,
  SyncEpoch,
  SyncProtocolCode,
  SyncProtocolError,
  SyncPullRequest,
  SyncPullResult,
  syncProtocolError,
} from "@store/contracts";
import { inventoryState } from "@store/db/inventory.schema";
import {
  commitPreparedCommand,
  getReceipt,
  pullTransactions,
  registerReplica,
  type InventoryDb,
} from "@store/sync";
import type { RuntimeContext } from "alchemy";
import type * as Cloudflare from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type * as HttpBody from "effect/unstable/http/HttpBody";
import type * as HttpServerError from "effect/unstable/http/HttpServerError";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

export type InventorySyncActor = {
  readonly organizationId: string;
  readonly userId: string;
  readonly authorizationExpiresAt: number;
};

export const InventorySyncActor = Schema.Struct({
  organizationId: Schema.String.check(Schema.isMinLength(1)),
  userId: Schema.String.check(Schema.isMinLength(1)),
  authorizationExpiresAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
});

export type ReadyInventoryIdentity = {
  readonly _tag: "ready";
  readonly organizationId: OrganizationId;
  readonly importId: InventoryImportId;
  readonly releaseId: InventoryReleaseId;
  readonly epoch: SyncEpoch;
};

export type StoredInventoryIdentity =
  | {
      readonly _tag: "importing";
      readonly organizationId: OrganizationId;
      readonly importId: InventoryImportId;
      readonly releaseId: InventoryReleaseId | undefined;
    }
  | ReadyInventoryIdentity;

export type InventoryTransactionHost = {
  readonly transaction: <A>(run: (tx: InventoryDb) => A) => A;
};

export type RoutedRpcCall<Input> = {
  readonly route: InventoryRoutingContext;
  readonly actor: InventorySyncActor;
  readonly input: Input;
};

export type RpcProtocolFailure = {
  readonly _tag: "protocolFailure";
  readonly code: SyncProtocolCode;
  readonly message: string;
};

export type RpcSuccess<Value> = {
  readonly _tag: "success";
  readonly value: Value;
};

export type RpcReply<Value> = RpcSuccess<Value> | RpcProtocolFailure;

export const RpcProtocolFailure = Schema.Struct({
  _tag: Schema.Literal("protocolFailure"),
  code: SyncProtocolError.fields.code,
  message: Schema.String,
});

export const RpcReply = <S extends Schema.Top>(value: S) =>
  Schema.Union([
    Schema.Struct({
      _tag: Schema.Literal("success"),
      value,
    }),
    RpcProtocolFailure,
  ]);

export const ReceiptLookup = Schema.TaggedUnion({
  found: { receipt: CommandReceipt },
  missing: {},
});
export type ReceiptLookup = typeof ReceiptLookup.Type;

export const SnapshotPartLocator = Schema.Struct({
  objectKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  byteLength: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  sha256: SnapshotPartHash,
});
export type SnapshotPartLocator = typeof SnapshotPartLocator.Type;

export const SnapshotPartLookup = Schema.TaggedUnion({
  found: { locator: SnapshotPartLocator },
  missing: {},
});
export type SnapshotPartLookup = typeof SnapshotPartLookup.Type;

export const RoutedReplicaCall = Schema.Struct({
  route: InventoryRoutingContext,
  actor: InventorySyncActor,
  input: RegisterReplicaRequest,
});

export const RoutedCommandCall = Schema.Struct({
  route: InventoryRoutingContext,
  actor: InventorySyncActor,
  input: SyncCommandEnvelope,
});

export const RoutedReceiptCall = Schema.Struct({
  route: InventoryRoutingContext,
  actor: InventorySyncActor,
  input: Schema.Struct({
    operationId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  }),
});

export const RoutedPullCall = Schema.Struct({
  route: InventoryRoutingContext,
  actor: InventorySyncActor,
  input: SyncPullRequest,
});

export const RoutedSnapshotCall = Schema.Struct({
  route: InventoryRoutingContext,
  actor: InventorySyncActor,
  input: AcquireSnapshotRequest,
});

export const RoutedSnapshotPartCall = Schema.Struct({
  route: InventoryRoutingContext,
  actor: InventorySyncActor,
  input: Schema.Struct({
    snapshotId: SnapshotId,
    partNumber: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  }),
});

export const RoutedLiveTicketCall = Schema.Struct({
  route: InventoryRoutingContext,
  actor: InventorySyncActor,
  input: LiveTicketRequest,
});

export type RoutedReplicaCallWire = typeof RoutedReplicaCall.Encoded;
export type RoutedCommandCallWire = typeof RoutedCommandCall.Encoded;
export type RoutedReceiptCallWire = typeof RoutedReceiptCall.Encoded;
export type RoutedPullCallWire = typeof RoutedPullCall.Encoded;
export type RoutedSnapshotCallWire = typeof RoutedSnapshotCall.Encoded;
export type RoutedSnapshotPartCallWire = typeof RoutedSnapshotPartCall.Encoded;
export type RoutedLiveTicketCallWire = typeof RoutedLiveTicketCall.Encoded;

const isSyncProtocolError = Schema.is(SyncProtocolError);

export const rpcSuccess = <Value>(value: Value): RpcSuccess<Value> => ({
  _tag: "success",
  value,
});

export const rpcProtocolFailure = (
  code: SyncProtocolCode,
  message: string,
): RpcProtocolFailure => ({
  _tag: "protocolFailure",
  code,
  message,
});

export const runLibraryCommand = <Value>(run: () => Value): RpcReply<Value> => {
  try {
    return rpcSuccess(run());
  } catch (error) {
    if (isSyncProtocolError(error)) {
      return rpcProtocolFailure(error.code, error.message);
    }
    throw error;
  }
};

export const unimplementedWakePass = (): never => {
  throw new Error("unimplementedWakePass");
};

export const unimplementedLiveDelivery = (): never => {
  throw new Error("unimplementedLiveDelivery");
};

export const unimplementedSnapshotAuthority = (): never => {
  throw new Error("unimplementedSnapshotAuthority");
};

export const unimplementedRetentionPass = (): never => {
  throw new Error("unimplementedRetentionPass");
};

export const unimplementedPartitionDigest = (): never => {
  throw new Error("unimplementedPartitionDigest");
};

export class SnapshotObjectUnavailable extends Schema.TaggedError<SnapshotObjectUnavailable>()(
  "SnapshotObjectUnavailable",
  { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {}

export interface SnapshotObjectsContract {
  readonly getObject: (
    objectKey: string,
  ) => Effect.Effect<Uint8Array | undefined, SnapshotObjectUnavailable, RuntimeContext>;
  readonly putObject: (
    objectKey: string,
    bytes: Uint8Array,
  ) => Effect.Effect<void, SnapshotObjectUnavailable, RuntimeContext>;
}

export class SnapshotObjects extends Context.Service<SnapshotObjects, SnapshotObjectsContract>()(
  "@store/server/SnapshotObjects",
) {}

export const makeR2SnapshotObjects = (client: {
  readonly get: (
    key: string,
  ) => Effect.Effect<
    { readonly bytes: () => Effect.Effect<Uint8Array, unknown> } | null,
    unknown,
    RuntimeContext
  >;
  readonly put: (key: string, value: Uint8Array) => Effect.Effect<unknown, unknown, RuntimeContext>;
}): SnapshotObjectsContract => ({
  getObject: Effect.fn("SnapshotObjects.getObject")(function* (objectKey: string) {
    const object = yield* client.get(objectKey).pipe(
      Effect.mapError((cause) =>
        SnapshotObjectUnavailable.make({
          message: "Inventory snapshot storage is unavailable.",
          cause,
        }),
      ),
    );
    if (object === null) return undefined;
    return yield* object.bytes().pipe(
      Effect.mapError((cause) =>
        SnapshotObjectUnavailable.make({
          message: "Inventory snapshot storage is unavailable.",
          cause,
        }),
      ),
    );
  }),
  putObject: Effect.fn("SnapshotObjects.putObject")(function* (
    objectKey: string,
    bytes: Uint8Array,
  ) {
    yield* client.put(objectKey, bytes).pipe(
      Effect.mapError((cause) =>
        SnapshotObjectUnavailable.make({
          message: "Inventory snapshot storage is unavailable.",
          cause,
        }),
      ),
    );
  }),
});

const decodeOrganizationId = Schema.decodeUnknownSync(OrganizationId);
const decodeImportId = Schema.decodeUnknownSync(InventoryImportId);
const decodeReleaseId = Schema.decodeUnknownSync(InventoryReleaseId);
const decodeEpoch = Schema.decodeUnknownSync(SyncEpoch);

export const loadStoredInventoryIdentity = (
  tx: InventoryDb,
): StoredInventoryIdentity | undefined => {
  const row = tx.select().from(inventoryState).get();
  if (!row) return undefined;
  const organizationId = decodeOrganizationId(row.organizationId);
  const importId = decodeImportId(row.importId);
  const releaseId = row.releaseId === null ? undefined : decodeReleaseId(row.releaseId);
  if (row.status === "ready" && releaseId !== undefined) {
    return {
      _tag: "ready",
      organizationId,
      importId,
      releaseId,
      epoch: decodeEpoch(row.epoch),
    };
  }
  return {
    _tag: "importing",
    organizationId,
    importId,
    releaseId,
  };
};

export const verifyRoutingEvidence = (
  tx: InventoryDb,
  evidence: InventoryRoutingContext,
): ReadyInventoryIdentity => {
  const stored = loadStoredInventoryIdentity(tx);
  if (!stored) {
    throw syncProtocolError("EPOCH_MISMATCH", "This organization inventory is not ready.");
  }
  if (
    stored.organizationId !== evidence.organizationId ||
    stored.importId !== evidence.importId ||
    stored.releaseId !== evidence.releaseId
  ) {
    throw syncProtocolError(
      "IMPORT_IDENTITY_MISMATCH",
      "The inventory object does not match the active release.",
    );
  }
  if (stored._tag !== "ready") {
    throw syncProtocolError("EPOCH_MISMATCH", "This organization inventory is not ready.");
  }
  return stored;
};

export const requireMatchingActor = (
  actor: InventorySyncActor,
  evidence: InventoryRoutingContext,
): void => {
  if (actor.organizationId !== evidence.organizationId) {
    throw syncProtocolError(
      "ORGANIZATION_MISMATCH",
      "The actor does not belong to the active organization.",
    );
  }
};

export const runVerifiedInventoryTransaction = <Value>(
  db: InventoryTransactionHost,
  evidence: InventoryRoutingContext,
  actor: InventorySyncActor,
  operation: (tx: InventoryDb, identity: ReadyInventoryIdentity) => Value,
): Value => {
  requireMatchingActor(actor, evidence);
  return db.transaction((tx) => {
    const identity = verifyRoutingEvidence(tx, evidence);
    return operation(tx, identity);
  });
};

const libraryActor = (actor: InventorySyncActor) => ({
  organizationId: actor.organizationId,
  userId: actor.userId,
});

export const commitRoutedCommand = (
  db: InventoryTransactionHost,
  call: RoutedRpcCall<SyncCommandEnvelope>,
  receivedAt: number,
): CommandReceipt =>
  runVerifiedInventoryTransaction(db, call.route, call.actor, (tx) =>
    commitPreparedCommand(tx, {
      actor: libraryActor(call.actor),
      envelope: call.input,
      receivedAt,
    }),
  );

export const registerRoutedReplica = (
  db: InventoryTransactionHost,
  call: RoutedRpcCall<RegisterReplicaRequest>,
  now: number,
): RegisterReplicaResult =>
  runVerifiedInventoryTransaction(db, call.route, call.actor, (tx) =>
    registerReplica(tx, libraryActor(call.actor), call.input, now),
  );

export const getRoutedReceipt = (
  db: InventoryTransactionHost,
  call: RoutedRpcCall<{ readonly operationId: string }>,
): ReceiptLookup =>
  runVerifiedInventoryTransaction(db, call.route, call.actor, (tx) => {
    const receipt = getReceipt(tx, libraryActor(call.actor), call.input.operationId);
    return receipt ? { _tag: "found" as const, receipt } : { _tag: "missing" as const };
  });

export const pullRoutedTransactions = (
  db: InventoryTransactionHost,
  call: RoutedRpcCall<SyncPullRequest>,
): SyncPullResult =>
  runVerifiedInventoryTransaction(db, call.route, call.actor, (tx, identity) =>
    pullTransactions(tx, {
      organizationId: identity.organizationId,
      epoch: call.input.epoch,
      subscription: call.input.subscription,
      afterCommitSequence: call.input.afterCommitSequence,
      limit: call.input.limit ?? MAX_SYNC_PULL_TRANSACTIONS,
    }),
  );

export const acquireRoutedSnapshot = (
  _db: InventoryTransactionHost,
  call: RoutedRpcCall<AcquireSnapshotRequest>,
): AcquireSnapshotResult => {
  requireMatchingActor(call.actor, call.route);
  return unimplementedSnapshotAuthority();
};

export const locateRoutedSnapshotPart = (
  _db: InventoryTransactionHost,
  call: RoutedRpcCall<{ readonly snapshotId: SnapshotId; readonly partNumber: number }>,
): SnapshotPartLookup => {
  requireMatchingActor(call.actor, call.route);
  return unimplementedSnapshotAuthority();
};

export const mintRoutedLiveTicket = (
  _db: InventoryTransactionHost,
  call: RoutedRpcCall<LiveTicketRequest>,
): LiveTicket => {
  requireMatchingActor(call.actor, call.route);
  return unimplementedLiveDelivery();
};

export type OrganizationInventoryRpc = {
  readonly registerReplica: (
    call: RoutedReplicaCallWire,
  ) => Effect.Effect<RpcReply<RegisterReplicaResult>, never, RuntimeContext>;
  readonly submitCommand: (
    call: RoutedCommandCallWire,
  ) => Effect.Effect<RpcReply<CommandReceipt>, never, RuntimeContext>;
  readonly getReceipt: (
    call: RoutedReceiptCallWire,
  ) => Effect.Effect<RpcReply<ReceiptLookup>, never, RuntimeContext>;
  readonly pull: (
    call: RoutedPullCallWire,
  ) => Effect.Effect<RpcReply<SyncPullResult>, never, RuntimeContext>;
  readonly acquireSnapshot: (
    call: RoutedSnapshotCallWire,
  ) => Effect.Effect<RpcReply<AcquireSnapshotResult>, never, RuntimeContext>;
  readonly mintLiveTicket: (
    call: RoutedLiveTicketCallWire,
  ) => Effect.Effect<RpcReply<LiveTicket>, never, RuntimeContext>;
  readonly locateSnapshotPart: (
    call: RoutedSnapshotPartCallWire,
  ) => Effect.Effect<RpcReply<SnapshotPartLookup>, never, RuntimeContext>;
  readonly fetch: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    HttpServerError.HttpServerError | HttpBody.HttpBodyError,
    | HttpServerRequest.HttpServerRequest
    | Scope.Scope
    | Cloudflare.DurableObjectState
    | RuntimeContext
  >;
  readonly alarm: (
    alarmInfo?: Cloudflare.AlarmInvocationInfo,
  ) => Effect.Effect<void, never, RuntimeContext>;
  readonly webSocketMessage: (
    socket: Cloudflare.WebSocket,
    message: string | ArrayBuffer,
  ) => Effect.Effect<void>;
  readonly webSocketClose: (
    socket: Cloudflare.WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ) => Effect.Effect<void>;
};

export type OrganizationInventoryNamespace = Cloudflare.DurableObject<OrganizationInventoryRpc>;

export type OrganizationInventoryRpcClient = Pick<
  OrganizationInventoryRpc,
  | "registerReplica"
  | "submitCommand"
  | "getReceipt"
  | "pull"
  | "acquireSnapshot"
  | "mintLiveTicket"
  | "locateSnapshotPart"
>;

export type OrganizationInventoryObjectsContract = {
  readonly getByName: (
    name: string,
    options?: Cloudflare.DurableObjectGetDurableObjectOptions,
  ) => OrganizationInventoryRpcClient;
};

export type OrganizationInventoryLiveObjectsContract = {
  readonly getByName: (
    name: string,
    options?: Cloudflare.DurableObjectGetDurableObjectOptions,
  ) => Pick<Cloudflare.DurableObjectStub<OrganizationInventoryRpc>, "fetch">;
};
