import {
  AcquireSnapshotRequest,
  AcquireSnapshotResult,
  canonicalJson,
  CommandReceipt,
  InventoryImportId,
  InventoryReleaseId,
  InventoryRoutingContext,
  LIVE_LEASE_LIFETIME_MILLIS,
  LiveSessionAttachment,
  LiveTicket,
  LiveTicketNonce,
  LiveTicketRequest,
  MAX_LIVE_FRAME_TRANSACTIONS,
  MAX_SYNC_PULL_TRANSACTIONS,
  MAX_TRANSPORT_PAYLOAD_BYTES,
  OrgCommitSequence,
  OrganizationId,
  RegisterReplicaRequest,
  RegisterReplicaResult,
  SnapshotId,
  SnapshotPartHash,
  SYNC_SCHEMA_VERSION,
  SyncCommandEnvelope,
  SyncEpoch,
  SyncLiveClientFrame,
  SyncLiveServerFrame,
  SyncProtocolCode,
  SyncProtocolError,
  SyncPullRequest,
  SyncPullResult,
  SyncSubscription,
  syncProtocolError,
  unpadDecimalSequence,
} from "@store/contracts";
import {
  inventoryState,
  liveSessions,
  replicas,
  snapshotJobs,
  snapshotParts,
} from "@store/db/inventory.schema";
import {
  acknowledgeLiveSession,
  closeLiveSession,
  commitPreparedCommand,
  consumeLiveTicket,
  decideDelivery,
  getReceipt,
  grantDownloadLease,
  mintLiveTicket,
  nextWakeDeadline,
  openLiveSession,
  partitionDigest,
  pruneExpiredSessions,
  pruneExpiredTickets,
  pullTransactions,
  readPublishedManifest,
  recordArmedWake,
  recordDelivered,
  recordUploadedPart,
  registerReplica,
  startSnapshotJob,
  stepRetention,
  stepSnapshotJob,
  type InventoryDb,
  type SnapshotStep,
  type WakeReason,
} from "@store/sync";
import type { RuntimeContext } from "alchemy";
import type * as Cloudflare from "alchemy/Cloudflare";
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
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
const decodeSubscription = Schema.decodeUnknownSync(SyncSubscription);
const decodeLiveNonce = Schema.decodeUnknownSync(LiveTicketNonce);
const decodeSnapshotId = Schema.decodeUnknownSync(SnapshotId);
const decodePartHash = Schema.decodeUnknownSync(SnapshotPartHash);
const decodeClientFrame = Schema.decodeUnknownResult(SyncLiveClientFrame);
const encodeServerFrame = Schema.encodeSync(SyncLiveServerFrame);
const decodeCommitSequence = Schema.decodeUnknownSync(OrgCommitSequence);
const utf8 = new TextEncoder();

const ACTIVE_SNAPSHOT_STAGES = ["copying", "repairing", "frozen", "exporting"] as const;

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

export type WakePassOutbound =
  | { readonly _tag: "none" }
  | {
      readonly _tag: "send";
      readonly sessionId: string;
      readonly throughCommitSequence: OrgCommitSequence;
      readonly frame: SyncLiveServerFrame;
    }
  | {
      readonly _tag: "resume";
      readonly sessionId: string;
      readonly frame: SyncLiveServerFrame;
    };

export type PreparedWakePass = {
  readonly outbound: WakePassOutbound;
  readonly snapshot: SnapshotStep;
};

export type WakePassResult = {
  readonly dueAt: number | undefined;
  readonly reason: WakeReason | undefined;
};

export type WakePassPorts = {
  readonly send: (sessionId: string, frame: SyncLiveServerFrame) => boolean;
  readonly upload: (objectKey: string, bytes: Uint8Array) => void;
};

export type LiveUpgradeRequest = {
  readonly nonce: LiveTicketNonce;
  readonly replicaId: string;
  readonly subscription: SyncSubscription;
  readonly userId: string;
  readonly authorizationExpiresAt: number;
  readonly now: number;
};

export type LiveMessageResult =
  | { readonly _tag: "ack"; readonly attachment: LiveSessionAttachment }
  | {
      readonly _tag: "resume";
      readonly frame: Extract<SyncLiveServerFrame, { readonly _tag: "resume" }>;
    }
  | { readonly _tag: "close" };

export const encodeLiveServerFrame = (frame: SyncLiveServerFrame): string =>
  JSON.stringify(encodeServerFrame(frame));

export const parseLiveClientFrame = (message: string): SyncLiveClientFrame | undefined => {
  try {
    const parsed: unknown = JSON.parse(message);
    const decoded = decodeClientFrame(parsed);
    if (Result.isFailure(decoded)) return undefined;
    return decoded.success;
  } catch {
    return undefined;
  }
};

export const createLiveTicketNonce = (): LiveTicketNonce => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return decodeLiveNonce(hex);
};

const readyIdentity = (tx: InventoryDb): ReadyInventoryIdentity | undefined => {
  const stored = loadStoredInventoryIdentity(tx);
  if (!stored || stored._tag !== "ready") return undefined;
  return stored;
};

const loadHeadSequence = (tx: InventoryDb, organizationId: string): string => {
  const state = tx
    .select()
    .from(inventoryState)
    .where(eq(inventoryState.organizationId, organizationId))
    .get();
  if (!state) {
    throw syncProtocolError("EPOCH_MISMATCH", "This organization inventory is not ready.");
  }
  return unpadDecimalSequence(state.commitSequence);
};

const stepActiveSnapshot = (tx: InventoryDb, organizationId: string, now: number): SnapshotStep => {
  const jobs = tx
    .select()
    .from(snapshotJobs)
    .where(eq(snapshotJobs.organizationId, organizationId))
    .all();
  let active: (typeof jobs)[number] | undefined;
  for (const job of jobs) {
    for (const stage of ACTIVE_SNAPSHOT_STAGES) {
      if (job.stage === stage) {
        active = job;
        break;
      }
    }
    if (active) break;
  }
  if (active === undefined) return { _tag: "quiescent" };
  return stepSnapshotJob(
    tx,
    organizationId,
    { snapshotId: decodeSnapshotId(active.snapshotId), value: active.fence },
    now,
  );
};

const snapshotPartBytes = (part: Extract<SnapshotStep, { readonly _tag: "upload" }>["part"]) => {
  const encoded = canonicalJson(part);
  if (encoded === undefined) return undefined;
  return utf8.encode(encoded);
};

const toOutbound = (
  tx: InventoryDb,
  identity: ReadyInventoryIdentity | undefined,
  delivery: ReturnType<typeof decideDelivery>,
): WakePassOutbound => {
  if (!identity) return { _tag: "none" };
  if (delivery._tag === "idle") return { _tag: "none" };
  if (delivery._tag === "resume") {
    return {
      _tag: "resume",
      sessionId: delivery.sessionId,
      frame: {
        _tag: "resume",
        epoch: identity.epoch,
        reason: delivery.reason,
        fromCommitSequence: delivery.fromCommitSequence,
      },
    };
  }
  const session = tx
    .select()
    .from(liveSessions)
    .where(
      and(
        eq(liveSessions.organizationId, identity.organizationId),
        eq(liveSessions.sessionId, delivery.sessionId),
      ),
    )
    .get();
  if (!session) return { _tag: "none" };
  const frame: SyncLiveServerFrame = {
    _tag: "transactions",
    epoch: identity.epoch,
    subscription: decodeSubscription(session.subscription),
    schemaVersion: SYNC_SCHEMA_VERSION,
    fromCommitSequence: delivery.fromCommitSequence,
    toCommitSequence: delivery.toCommitSequence,
    transactions: delivery.transactions,
  };
  if (utf8.encode(encodeLiveServerFrame(frame)).length > MAX_TRANSPORT_PAYLOAD_BYTES) {
    return {
      _tag: "resume",
      sessionId: delivery.sessionId,
      frame: {
        _tag: "resume",
        epoch: identity.epoch,
        reason: "send_window_lost",
        fromCommitSequence: delivery.fromCommitSequence,
      },
    };
  }
  return {
    _tag: "send",
    sessionId: delivery.sessionId,
    throughCommitSequence: delivery.toCommitSequence,
    frame,
  };
};

export const prepareWakePass = (
  db: InventoryTransactionHost,
  organizationId: string,
  now: number,
): PreparedWakePass =>
  db.transaction((tx) => {
    pruneExpiredSessions(tx, organizationId, now);
    pruneExpiredTickets(tx, organizationId, now);
    const identity = readyIdentity(tx);
    const delivery = decideDelivery(tx, organizationId, MAX_LIVE_FRAME_TRANSACTIONS);
    return {
      outbound: toOutbound(tx, identity, delivery),
      snapshot: stepActiveSnapshot(tx, organizationId, now),
    };
  });

export const recordWakeDelivery = (
  db: InventoryTransactionHost,
  organizationId: string,
  sessionId: string,
  throughCommitSequence: string,
): void => {
  db.transaction((tx) => {
    recordDelivered(tx, organizationId, sessionId, throughCommitSequence);
  });
};

export const settleWakeUpload = (
  db: InventoryTransactionHost,
  organizationId: string,
  step: Extract<SnapshotStep, { readonly _tag: "upload" }>,
  now: number,
): SnapshotStep =>
  db.transaction((tx) =>
    recordUploadedPart(
      tx,
      organizationId,
      step.fence,
      step.part,
      step.objectKey,
      step.byteLength,
      step.sha256,
      now,
    ),
  );

export const completeWakePass = (
  db: InventoryTransactionHost,
  organizationId: string,
  now: number,
): WakePassResult =>
  db.transaction((tx) => {
    stepRetention(tx, organizationId, now);
    const armed = nextWakeDeadline(tx, organizationId, now);
    if (armed === undefined) return { dueAt: undefined, reason: undefined };
    recordArmedWake(tx, armed);
    return { dueAt: armed.dueAt, reason: armed.reason };
  });

export const runWakePass = (
  db: InventoryTransactionHost,
  organizationId: string,
  now: number,
  ports: WakePassPorts,
): WakePassResult => {
  const prepared = prepareWakePass(db, organizationId, now);
  if (prepared.outbound._tag === "send") {
    const sent = ports.send(prepared.outbound.sessionId, prepared.outbound.frame);
    if (sent) {
      recordWakeDelivery(
        db,
        organizationId,
        prepared.outbound.sessionId,
        prepared.outbound.throughCommitSequence,
      );
    }
  } else if (prepared.outbound._tag === "resume") {
    ports.send(prepared.outbound.sessionId, prepared.outbound.frame);
  }
  if (prepared.snapshot._tag === "upload") {
    const bytes = snapshotPartBytes(prepared.snapshot.part);
    if (bytes !== undefined) {
      ports.upload(prepared.snapshot.objectKey, bytes);
      settleWakeUpload(db, organizationId, prepared.snapshot, now);
    }
  }
  return completeWakePass(db, organizationId, now);
};

export const acceptLiveUpgrade = (
  db: InventoryTransactionHost,
  request: LiveUpgradeRequest,
): LiveSessionAttachment =>
  db.transaction((tx) => {
    const identity = readyIdentity(tx);
    if (!identity) {
      throw syncProtocolError("EPOCH_MISMATCH", "This organization inventory is not ready.");
    }
    const replica = tx
      .select()
      .from(replicas)
      .where(
        and(
          eq(replicas.organizationId, identity.organizationId),
          eq(replicas.replicaId, request.replicaId),
        ),
      )
      .get();
    if (!replica) {
      throw syncProtocolError("REPLICA_UNKNOWN", "This replica is not registered.");
    }
    if (replica.ownerUserId !== request.userId) {
      throw syncProtocolError("REPLICA_OWNED_BY_OTHER", "This replica belongs to another user.");
    }
    const consumed = consumeLiveTicket(tx, identity.organizationId, request.nonce, request.now);
    if (consumed._tag === "rejected") {
      throw syncProtocolError("TICKET_INVALID", "The live ticket nonce is invalid.");
    }
    closeLiveSession(tx, identity.organizationId, request.replicaId);
    const head = loadHeadSequence(tx, identity.organizationId);
    const leaseExpiresAt = Math.min(
      request.authorizationExpiresAt,
      request.now + LIVE_LEASE_LIFETIME_MILLIS,
    );
    openLiveSession(tx, {
      organizationId: identity.organizationId,
      sessionId: request.replicaId,
      replicaId: request.replicaId,
      ownerUserId: request.userId,
      subscription: request.subscription,
      deliveredThroughCommitSequence: head,
      leaseExpiresAt,
    });
    return {
      version: 1,
      organizationId: identity.organizationId,
      replicaId: request.replicaId,
      userId: request.userId,
      subscription: request.subscription,
      leaseExpiresAt,
      acknowledgedCommitSequence: decodeCommitSequence(head),
    };
  });

const resumeFrame = (
  identity: ReadyInventoryIdentity,
  reason: Extract<SyncLiveServerFrame, { readonly _tag: "resume" }>["reason"],
  fromCommitSequence: OrgCommitSequence,
): Extract<SyncLiveServerFrame, { readonly _tag: "resume" }> => ({
  _tag: "resume",
  epoch: identity.epoch,
  reason,
  fromCommitSequence,
});

export const handleLiveClientMessage = (
  db: InventoryTransactionHost,
  attachment: LiveSessionAttachment,
  message: string,
  now: number,
): LiveMessageResult => {
  const identity = db.transaction((tx) => readyIdentity(tx));
  if (!identity) return { _tag: "close" };
  const parsed = parseLiveClientFrame(message);
  if (parsed === undefined) {
    return {
      _tag: "resume",
      frame: resumeFrame(identity, "send_window_lost", attachment.acknowledgedCommitSequence),
    };
  }
  const acknowledged = db.transaction((tx) =>
    acknowledgeLiveSession(
      tx,
      attachment.organizationId,
      attachment.replicaId,
      parsed.throughCommitSequence,
      now,
    ),
  );
  if (acknowledged._tag === "resume") {
    return {
      _tag: "resume",
      frame: resumeFrame(identity, acknowledged.reason, attachment.acknowledgedCommitSequence),
    };
  }
  return {
    _tag: "ack",
    attachment: {
      version: attachment.version,
      organizationId: attachment.organizationId,
      replicaId: attachment.replicaId,
      userId: attachment.userId,
      subscription: attachment.subscription,
      leaseExpiresAt: attachment.leaseExpiresAt,
      acknowledgedCommitSequence: acknowledged.throughCommitSequence,
    },
  };
};

export const closeLiveUpgrade = (
  db: InventoryTransactionHost,
  organizationId: string,
  sessionId: string,
): void => {
  db.transaction((tx) => {
    closeLiveSession(tx, organizationId, sessionId);
  });
};

export const encodeSnapshotUpload = (
  step: Extract<SnapshotStep, { readonly _tag: "upload" }>,
): Uint8Array | undefined => snapshotPartBytes(step.part);

export const liveUpgradeErrorStatus = (error: SyncProtocolError): number => {
  if (error.code === "TICKET_INVALID" || error.code === "INVALID_OPERATION") return 400;
  if (
    error.code === "ORGANIZATION_MISMATCH" ||
    error.code === "ACTOR_MISMATCH" ||
    error.code === "REPLICA_OWNED_BY_OTHER"
  ) {
    return 403;
  }
  return 409;
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
  runVerifiedInventoryTransaction(db, call.route, call.actor, (tx, identity) => {
    const pulled = pullTransactions(tx, {
      organizationId: identity.organizationId,
      epoch: call.input.epoch,
      subscription: call.input.subscription,
      afterCommitSequence: call.input.afterCommitSequence,
      limit: call.input.limit ?? MAX_SYNC_PULL_TRANSACTIONS,
    });
    if (pulled.nextCommitSequence !== pulled.horizon) return pulled;
    return {
      ...pulled,
      digest: partitionDigest(tx, identity.organizationId, call.input.subscription),
    };
  });

export const acquireRoutedSnapshot = (
  db: InventoryTransactionHost,
  call: RoutedRpcCall<AcquireSnapshotRequest>,
  now: number,
): AcquireSnapshotResult =>
  runVerifiedInventoryTransaction(db, call.route, call.actor, (tx, identity) => {
    if (call.input.epoch !== identity.epoch) {
      throw syncProtocolError("EPOCH_MISMATCH", "The replica epoch does not match.");
    }
    const published = readPublishedManifest(tx, identity.organizationId);
    if (published && published.subscription === call.input.subscription) {
      grantDownloadLease(
        tx,
        identity.organizationId,
        call.actor.userId,
        published.snapshotId,
        published.horizon,
        now + LIVE_LEASE_LIFETIME_MILLIS,
      );
      return { _tag: "ready" as const, manifest: published };
    }
    const started = startSnapshotJob(
      tx,
      identity.organizationId,
      decodeSnapshotId(crypto.randomUUID()),
      now,
    );
    if (started._tag !== "advanced") {
      throw syncProtocolError("SNAPSHOT_UNAVAILABLE", "That snapshot is not available.");
    }
    const retryAfterMillis = Math.max(1, started.stepDueAt - now);
    return {
      _tag: "building" as const,
      snapshotId: started.fence.snapshotId,
      retryAfterMillis,
    };
  });

export const locateRoutedSnapshotPart = (
  db: InventoryTransactionHost,
  call: RoutedRpcCall<{ readonly snapshotId: SnapshotId; readonly partNumber: number }>,
): SnapshotPartLookup =>
  runVerifiedInventoryTransaction(db, call.route, call.actor, (tx, identity) => {
    const row = tx
      .select()
      .from(snapshotParts)
      .where(
        and(
          eq(snapshotParts.organizationId, identity.organizationId),
          eq(snapshotParts.snapshotId, call.input.snapshotId),
          eq(snapshotParts.partNumber, call.input.partNumber),
        ),
      )
      .get();
    if (!row) return { _tag: "missing" as const };
    return {
      _tag: "found" as const,
      locator: {
        objectKey: row.objectKey,
        byteLength: row.byteLength,
        sha256: decodePartHash(row.sha256),
      },
    };
  });

export const mintRoutedLiveTicket = (
  db: InventoryTransactionHost,
  call: RoutedRpcCall<LiveTicketRequest>,
  now: number,
  nonce: LiveTicketNonce,
): LiveTicket =>
  runVerifiedInventoryTransaction(db, call.route, call.actor, (tx, identity) => {
    const replica = tx
      .select()
      .from(replicas)
      .where(
        and(
          eq(replicas.organizationId, identity.organizationId),
          eq(replicas.replicaId, call.input.replicaId),
        ),
      )
      .get();
    if (!replica) {
      throw syncProtocolError("REPLICA_UNKNOWN", "This replica is not registered.");
    }
    if (replica.ownerUserId !== call.actor.userId) {
      throw syncProtocolError("REPLICA_OWNED_BY_OTHER", "This replica belongs to another user.");
    }
    const minted = mintLiveTicket(tx, identity.organizationId, call.input.replicaId, nonce, now);
    if (minted._tag === "rejected") {
      throw syncProtocolError("TICKET_INVALID", "The live ticket nonce is invalid.");
    }
    return {
      nonce,
      organizationId: identity.organizationId,
      subscription: call.input.subscription,
      expiresAt: minted.expiresAt,
    };
  });

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
