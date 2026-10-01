import {
  AcquireSnapshotRequest,
  AcquireSnapshotResult,
  CommandReceipt,
  RegisterReplicaRequest,
  RegisterReplicaResult,
  SnapshotPartPayload,
  SyncProtocolError,
  SyncPullRequest,
  SyncPullResult,
  SyncSubmitCommandRequest,
  SyncSubmitCommandResult,
} from "@store/contracts";
import {
  failureFromStatus,
  mapSyncFailure,
  retryAfterMillis,
  SYNC_REQUEST_TIMEOUT_MILLIS,
  SyncTransportOffline,
  withRequestDeadlines,
  type SyncFailure,
  type SyncTransport,
} from "@store/sync";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export type SyncProxyRequest = {
  readonly method: "GET" | "POST";
  readonly pathname: string;
  readonly bodyText: string | null;
  readonly timeoutMillis: number;
};

export type SyncProxyResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly bodyText: string;
  readonly retryAfter?: string;
};

export type SyncProxyFetch = (request: SyncProxyRequest) => Promise<SyncProxyResponse>;

type SyncOperation = keyof typeof SYNC_REQUEST_TIMEOUT_MILLIS;

type SyncProxyPostBody =
  | RegisterReplicaRequest
  | SyncSubmitCommandRequest
  | SyncPullRequest
  | AcquireSnapshotRequest;

const SyncHttpErrorBody = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String,
  }),
});

export const decodeHttpErrorBody = Schema.decodeUnknownOption(
  Schema.fromJsonString(SyncHttpErrorBody),
);

const mapHttpFailure = (response: SyncProxyResponse, now: number) => {
  const { status, bodyText } = response;
  const delay =
    response.retryAfter === undefined ? undefined : retryAfterMillis(response.retryAfter, now);
  if (delay !== undefined) {
    return failureFromStatus(status, `Sync request failed with status ${status}.`, delay);
  }
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

const readJson =
  <A, I>(schema: Schema.Codec<A, I>) =>
  (response: SyncProxyResponse): Effect.Effect<A, Schema.SchemaError | SyncFailure> =>
    response.ok
      ? Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(response.bodyText)
      : Effect.flatMap(Clock.currentTimeMillis, (now) =>
          Effect.fail(mapHttpFailure(response, now)),
        );

const toTransportFailure = <A, E extends Error>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, SyncFailure> =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Effect.mapError(effect, (cause) => mapSyncFailure(cause, now)),
  );

export const makeProxySyncTransport = (proxyFetch: SyncProxyFetch): SyncTransport => {
  const exchange = (
    operation: SyncOperation,
    method: "GET" | "POST",
    pathname: string,
    bodyText: string | null,
  ) =>
    Effect.tryPromise({
      try: () =>
        proxyFetch({
          method,
          pathname,
          bodyText,
          timeoutMillis: SYNC_REQUEST_TIMEOUT_MILLIS[operation],
        }),
      catch: (cause) =>
        cause instanceof Error
          ? cause
          : SyncTransportOffline.make({ message: "The sync transport is unavailable." }),
    });

  const postJson = <A, I>(
    operation: SyncOperation,
    pathname: string,
    schema: Schema.Codec<A, I>,
    payload: SyncProxyPostBody,
  ) =>
    asJsonPayload(payload).pipe(
      Effect.flatMap(encodeJsonBody),
      Effect.flatMap((bodyText) => exchange(operation, "POST", pathname, bodyText)),
      Effect.flatMap(readJson(schema)),
      toTransportFailure,
    );

  const getJson = <A, I>(operation: SyncOperation, pathname: string, schema: Schema.Codec<A, I>) =>
    exchange(operation, "GET", pathname, null).pipe(
      Effect.flatMap(readJson(schema)),
      toTransportFailure,
    );

  const getOptionalJson = <A, I>(
    operation: SyncOperation,
    pathname: string,
    schema: Schema.Codec<A, I>,
  ) =>
    exchange(operation, "GET", pathname, null).pipe(
      Effect.flatMap((response) =>
        response.status === 404 ? Effect.succeed(undefined) : readJson(schema)(response),
      ),
      toTransportFailure,
    );

  return withRequestDeadlines({
    registerReplica: (request) =>
      postJson("registerReplica", "/api/sync/replicas", RegisterReplicaResult, request),
    submitCommand: (request) =>
      postJson("submitCommand", "/api/sync/commands", SyncSubmitCommandResult, request),
    getReceipt: (operationId) =>
      getOptionalJson(
        "getReceipt",
        `/api/sync/receipts/${encodeURIComponent(operationId)}`,
        CommandReceipt,
      ),
    pull: (request) => postJson("pull", "/api/sync/pull", SyncPullResult, request),
    acquireSnapshot: (request) =>
      postJson("acquireSnapshot", "/api/sync/snapshots", AcquireSnapshotResult, request),
    readSnapshotPart: (snapshotId, partNumber) =>
      getJson(
        "readSnapshotPart",
        `/api/sync/snapshots/${encodeURIComponent(snapshotId)}/parts/${partNumber}`,
        SnapshotPartPayload,
      ),
  });
};
