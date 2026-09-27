import {
  AcquireSnapshotRequest,
  AcquireSnapshotResult,
  CommandReceipt,
  LiveTicket,
  LiveTicketRequest,
  RegisterReplicaRequest,
  RegisterReplicaResult,
  SnapshotPartPayload,
  SyncCommandEnvelope,
  SyncProtocolError,
  SyncPullRequest,
  SyncPullResult,
} from "@store/contracts";
import {
  failureFromStatus,
  mapSyncFailure,
  SyncTransportOffline,
  type SyncTransport,
  type SyncFailure,
} from "@store/sync";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export type SyncProxyFetch = (
  method: "GET" | "POST",
  pathname: string,
  bodyText: string | null,
) => Promise<{ readonly ok: boolean; readonly status: number; readonly bodyText: string }>;

type SyncProxyPostBody =
  | RegisterReplicaRequest
  | SyncCommandEnvelope
  | SyncPullRequest
  | AcquireSnapshotRequest
  | LiveTicketRequest;

const SyncHttpErrorBody = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String,
  }),
});

const decodeHttpErrorBody = Schema.decodeUnknownOption(Schema.fromJsonString(SyncHttpErrorBody));

const mapHttpFailure = (status: number, bodyText: string) => {
  const parsed = decodeHttpErrorBody(bodyText);
  if (Option.isSome(parsed)) {
    const decoded = Schema.decodeUnknownOption(SyncProtocolError)({
      _tag: "SyncProtocolError",
      code: parsed.value.error.code,
      message: parsed.value.error.message,
    });
    if (Option.isSome(decoded)) return decoded.value;
  }
  return failureFromStatus(status, `Sync request failed with status ${status}.`);
};

const encodeJsonBody = Schema.encodeEffect(Schema.fromJsonString(Schema.Json));

const asJsonPayload = Schema.decodeUnknownEffect(Schema.Json);

type SyncProxyResponse = Awaited<ReturnType<SyncProxyFetch>>;

const readJson =
  <A, I>(schema: Schema.Codec<A, I>) =>
  (response: SyncProxyResponse): Effect.Effect<A, Schema.SchemaError | SyncFailure> =>
    response.ok
      ? Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(response.bodyText)
      : Effect.fail(mapHttpFailure(response.status, response.bodyText));

const toTransportFailure = <A, E extends Error>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, SyncFailure> =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Effect.mapError(effect, (cause) => mapSyncFailure(cause, now)),
  );

export const makeProxySyncTransport = (proxyFetch: SyncProxyFetch): SyncTransport => {
  const exchange = (method: "GET" | "POST", pathname: string, bodyText: string | null) =>
    Effect.tryPromise({
      try: () => proxyFetch(method, pathname, bodyText),
      catch: (cause) =>
        cause instanceof Error
          ? cause
          : SyncTransportOffline.make({ message: "The sync transport is unavailable." }),
    });

  const postJson = <A, I>(
    pathname: string,
    schema: Schema.Codec<A, I>,
    payload: SyncProxyPostBody,
  ) =>
    asJsonPayload(payload).pipe(
      Effect.flatMap(encodeJsonBody),
      Effect.flatMap((bodyText) => exchange("POST", pathname, bodyText)),
      Effect.flatMap(readJson(schema)),
      toTransportFailure,
    );

  const getJson = <A, I>(pathname: string, schema: Schema.Codec<A, I>) =>
    exchange("GET", pathname, null).pipe(Effect.flatMap(readJson(schema)), toTransportFailure);

  const getOptionalJson = <A, I>(pathname: string, schema: Schema.Codec<A, I>) =>
    exchange("GET", pathname, null).pipe(
      Effect.flatMap((response) =>
        response.status === 404 ? Effect.succeed(undefined) : readJson(schema)(response),
      ),
      toTransportFailure,
    );

  return {
    registerReplica: (request) => postJson("/api/sync/replicas", RegisterReplicaResult, request),
    submitCommand: (envelope) => postJson("/api/sync/commands", CommandReceipt, envelope),
    getReceipt: (operationId) =>
      getOptionalJson(`/api/sync/receipts/${encodeURIComponent(operationId)}`, CommandReceipt),
    pull: (request) => postJson("/api/sync/pull", SyncPullResult, request),
    acquireSnapshot: (request) => postJson("/api/sync/snapshots", AcquireSnapshotResult, request),
    readSnapshotPart: (snapshotId, partNumber) =>
      getJson(
        `/api/sync/snapshots/${encodeURIComponent(snapshotId)}/parts/${partNumber}`,
        SnapshotPartPayload,
      ),
    mintLiveTicket: (request) => postJson("/api/sync/live-tickets", LiveTicket, request),
  };
};
