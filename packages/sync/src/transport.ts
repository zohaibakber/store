import type {
  AcquireSnapshotRequest,
  AcquireSnapshotResult,
  CommandReceipt,
  RegisterReplicaRequest,
  RegisterReplicaResult,
  SnapshotId,
  SnapshotPartPayload,
  SyncPullRequest,
  SyncPullResult,
  SyncSubmitCommandRequest,
  SyncSubmitCommandResult,
} from "@store/contracts";
import { SyncProtocolCode, SyncProtocolError } from "@store/contracts";
import { honourRetryAfter, isAuthStatus } from "@store/contracts/http-errors";
import { SyncHttpApi } from "@store/contracts/sync/api";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import * as Headers from "effect/http/Headers";
import * as HttpClientError from "effect/http/HttpClientError";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  ReplicaCoverageRepairRequired,
  ReplicaStorageError,
  SyncRecoveryRequired,
} from "./replica/errors";
import type { Suspension } from "./sync-state";

const OptionalNumber = Schema.optionalKey(Schema.Number);

export class SyncTransportUnavailable extends Schema.TaggedError<SyncTransportUnavailable>()(
  "SyncTransportUnavailable",
  {
    message: Schema.String,
    status: OptionalNumber,
    retryAfterMillis: OptionalNumber,
  },
) {}

export class SyncTransportOffline extends Schema.TaggedError<SyncTransportOffline>()(
  "SyncTransportOffline",
  {
    message: Schema.String,
  },
) {}

class SyncTransportAuthRequired extends Schema.TaggedError<SyncTransportAuthRequired>()(
  "SyncTransportAuthRequired",
  {
    message: Schema.String,
    status: Schema.Number,
  },
) {}

class SyncTransportRefused extends Schema.TaggedError<SyncTransportRefused>()(
  "SyncTransportRefused",
  {
    message: Schema.String,
    status: OptionalNumber,
  },
) {}

export class SyncTransportGarbled extends Schema.TaggedError<SyncTransportGarbled>()(
  "SyncTransportGarbled",
  {
    message: Schema.String,
    status: OptionalNumber,
  },
) {}

export type SyncTransportError =
  | SyncTransportUnavailable
  | SyncTransportOffline
  | SyncTransportAuthRequired
  | SyncTransportRefused
  | SyncTransportGarbled;

export type SyncFailure = SyncTransportError | SyncProtocolError;

type SyncCycleFailure =
  | SyncFailure
  | ReplicaStorageError
  | ReplicaCoverageRepairRequired
  | SyncRecoveryRequired;

export type RecoverableCode = "EPOCH_MISMATCH" | "INCARNATION_MISMATCH" | "SNAPSHOT_REQUIRED";

export type SyncFailureSuspect = {
  readonly reason: "garbledResponses" | "refused";
  readonly message: string;
  readonly status?: number;
};

export type SyncFailureDisposition =
  | {
      readonly _tag: "retry";
      readonly delayMillis: number | undefined;
      readonly suspect?: SyncFailureSuspect;
    }
  | { readonly _tag: "recover"; readonly code: RecoverableCode }
  | { readonly _tag: "suspend"; readonly suspension: Suspension };

const AUTH_REQUIRED_MESSAGE =
  "Sign in again to resume syncing. Pending changes are saved on this device.";

const GARBLED_MESSAGE =
  "The server sent responses this app could not read. Sync keeps retrying on its own. Pending changes are saved on this device.";

const REFUSED_MESSAGE =
  "The server refused the sync request. Sync keeps retrying on its own. Pending changes are saved on this device.";

const decodeRetryAfterSeconds = Schema.decodeUnknownOption(
  Schema.FiniteFromString.check(Schema.isGreaterThanOrEqualTo(0)),
);
const decodeRetryAfterDate = Schema.decodeUnknownOption(Schema.DateFromString);

export const retryAfterMillis = (header: string, nowMillis: number): number | undefined => {
  const trimmed = header.trim();
  if (trimmed.length === 0) return undefined;
  const seconds = decodeRetryAfterSeconds(trimmed);
  if (Option.isSome(seconds)) return Math.round(seconds.value * 1_000);
  const date = decodeRetryAfterDate(trimmed);
  if (Option.isSome(date)) return Math.max(0, date.value.getTime() - nowMillis);
  return undefined;
};

const decodeProtocolCode = Schema.decodeUnknownOption(SyncProtocolCode);

const statusForErrorTag = (tag: string): number => {
  if (tag === "BadRequest") return 400;
  if (tag === "Forbidden") return 403;
  if (tag === "NotFound") return 404;
  if (tag === "Conflict") return 409;
  return 503;
};

const TypedHttpError = Schema.Struct({
  _tag: Schema.String,
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String,
  }),
});
export type SyncHttpErrorBody = typeof TypedHttpError.Type;
const decodeTypedHttpError = Schema.decodeUnknownOption(TypedHttpError);

export type SyncFailureCause =
  | SyncCycleFailure
  | HttpClientError.HttpClientError
  | Schema.SchemaError
  | SyncHttpErrorBody
  | Error;

export const failureFromStatus = (
  status: number,
  message: string,
  retryAfter?: number,
): SyncTransportError => {
  if (isAuthStatus(status)) {
    return new SyncTransportAuthRequired({ message, status });
  }
  if (retryAfter !== undefined || status === 408 || status === 429 || status >= 500) {
    return new SyncTransportUnavailable(
      retryAfter === undefined
        ? { message, status }
        : { message, status, retryAfterMillis: retryAfter },
    );
  }
  return new SyncTransportRefused({ message, status });
};

const fromTypedHttpError = (tag: string, code: string, message: string): SyncFailure => {
  const protocolCode = decodeProtocolCode(code);
  if (Option.isSome(protocolCode)) {
    return new SyncProtocolError({ code: protocolCode.value, message });
  }
  return failureFromStatus(statusForErrorTag(tag), message);
};

const isSuccessStatus = (status: number): boolean => status >= 200 && status < 300;

const fromHttpClientError = (error: HttpClientError.HttpClientError, now: number): SyncFailure => {
  const reason = error.reason;
  if (
    reason._tag !== "StatusCodeError" &&
    reason._tag !== "DecodeError" &&
    reason._tag !== "EmptyBodyError"
  ) {
    return new SyncTransportOffline({ message: error.message });
  }
  const status = reason.response.status;
  if (reason._tag !== "StatusCodeError" && isSuccessStatus(status)) {
    return new SyncTransportGarbled({ message: error.message, status });
  }
  const header = Headers.get(reason.response.headers, "retry-after");
  const delay = Option.isSome(header) ? retryAfterMillis(header.value, now) : undefined;
  return failureFromStatus(status, error.message, delay);
};

export const mapSyncFailure = (error: SyncFailureCause, now: number): SyncFailure => {
  if (error instanceof SyncProtocolError) return error;
  if (
    error instanceof SyncTransportUnavailable ||
    error instanceof SyncTransportOffline ||
    error instanceof SyncTransportAuthRequired ||
    error instanceof SyncTransportRefused ||
    error instanceof SyncTransportGarbled
  ) {
    return error;
  }
  if (HttpClientError.isHttpClientError(error)) return fromHttpClientError(error, now);
  if (error instanceof Schema.SchemaError) {
    return new SyncTransportGarbled({ message: error.message });
  }
  const typed = decodeTypedHttpError(error);
  if (Option.isSome(typed)) {
    return fromTypedHttpError(typed.value._tag, typed.value.error.code, typed.value.error.message);
  }
  return new SyncTransportOffline({
    message: error instanceof Error ? error.message : "The sync transport is unavailable.",
  });
};

export const classifySyncFailure = (error: SyncFailureCause, now: number): SyncCycleFailure =>
  error instanceof ReplicaStorageError ||
  error instanceof ReplicaCoverageRepairRequired ||
  error instanceof SyncRecoveryRequired
    ? error
    : mapSyncFailure(error, now);

const suspect = (
  reason: SyncFailureSuspect["reason"],
  message: string,
  status: number | undefined,
): SyncFailureDisposition => ({
  _tag: "retry",
  delayMillis: undefined,
  suspect: status === undefined ? { reason, message } : { reason, message, status },
});

const recoveryRequired = (code: SyncProtocolCode, message: string): SyncFailureDisposition => ({
  _tag: "suspend",
  suspension: {
    reason: "recoveryRequired",
    message,
    code,
    blocks: code === "REPLICA_SEQUENCE_GAP" ? "uploads" : "all",
    timer: false,
  },
});

const protocolSuspension = (
  reason: "updateRequired" | "protocol",
  error: SyncProtocolError,
): SyncFailureDisposition => ({
  _tag: "suspend",
  suspension: { reason, message: error.message, code: error.code, blocks: "all", timer: false },
});

const protocolDisposition = (error: SyncProtocolError): SyncFailureDisposition => {
  switch (error.code) {
    case "EPOCH_MISMATCH":
    case "INCARNATION_MISMATCH":
    case "SNAPSHOT_REQUIRED":
      return { _tag: "recover", code: error.code };
    case "REPLICA_SEQUENCE_GAP":
      return recoveryRequired(error.code, error.message);
    case "SCHEMA_VERSION_UNSUPPORTED":
      return protocolSuspension("updateRequired", error);
    default:
      return protocolSuspension("protocol", error);
  }
};

export const dispositionFor = (error: SyncCycleFailure): SyncFailureDisposition => {
  switch (error._tag) {
    case "ReplicaStorageError":
      return {
        _tag: "suspend",
        suspension: { reason: "storage", message: error.message, blocks: "all", timer: true },
      };
    case "ReplicaCoverageRepairRequired":
      return { _tag: "recover", code: "SNAPSHOT_REQUIRED" };
    case "SyncRecoveryRequired":
      return recoveryRequired(error.code, error.message);
    case "SyncProtocolError":
      return protocolDisposition(error);
    case "SyncTransportAuthRequired":
      return {
        _tag: "suspend",
        suspension: {
          reason: "auth",
          message: AUTH_REQUIRED_MESSAGE,
          status: error.status,
          blocks: "all",
          timer: true,
        },
      };
    case "SyncTransportRefused":
      return suspect("refused", REFUSED_MESSAGE, error.status);
    case "SyncTransportGarbled":
      return suspect("garbledResponses", GARBLED_MESSAGE, error.status);
    case "SyncTransportUnavailable":
      return { _tag: "retry", delayMillis: error.retryAfterMillis };
    case "SyncTransportOffline":
      return { _tag: "retry", delayMillis: undefined };
  }
};

const mapTransportFailure = <A, E extends SyncFailureCause, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, SyncTransportError | SyncProtocolError, R> =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Effect.mapError(effect, (error) => mapSyncFailure(error, now)),
  );

export type SyncTransport = {
  readonly registerReplica: (
    request: RegisterReplicaRequest,
  ) => Effect.Effect<RegisterReplicaResult, SyncTransportError | SyncProtocolError>;
  readonly submitCommand: (
    request: SyncSubmitCommandRequest,
  ) => Effect.Effect<SyncSubmitCommandResult, SyncTransportError | SyncProtocolError>;
  readonly getReceipt: (
    operationId: string,
  ) => Effect.Effect<CommandReceipt | undefined, SyncTransportError | SyncProtocolError>;
  readonly pull: (
    request: SyncPullRequest,
  ) => Effect.Effect<SyncPullResult, SyncTransportError | SyncProtocolError>;
  readonly acquireSnapshot: (
    request: AcquireSnapshotRequest,
  ) => Effect.Effect<AcquireSnapshotResult, SyncTransportError | SyncProtocolError>;
  readonly readSnapshotPart: (
    snapshotId: SnapshotId,
    partNumber: number,
  ) => Effect.Effect<SnapshotPartPayload, SyncTransportError | SyncProtocolError>;
};

export const SYNC_REQUEST_TIMEOUT_MILLIS = {
  registerReplica: 15_000,
  submitCommand: 15_000,
  getReceipt: 30_000,
  pull: 30_000,
  acquireSnapshot: 30_000,
  readSnapshotPart: 30_000,
} as const satisfies Record<keyof SyncTransport, number>;

const withDeadline =
  (operation: keyof SyncTransport) =>
  <A, R>(
    effect: Effect.Effect<A, SyncTransportError | SyncProtocolError, R>,
  ): Effect.Effect<A, SyncTransportError | SyncProtocolError, R> =>
    Effect.timeoutOrElse(effect, {
      duration: SYNC_REQUEST_TIMEOUT_MILLIS[operation],
      orElse: () =>
        Effect.fail(
          new SyncTransportOffline({
            message: `The sync ${operation} request did not finish within ${SYNC_REQUEST_TIMEOUT_MILLIS[operation]} ms.`,
          }),
        ),
    });

export const withRequestDeadlines = (transport: SyncTransport): SyncTransport => ({
  registerReplica: (request) => withDeadline("registerReplica")(transport.registerReplica(request)),
  submitCommand: (request) => withDeadline("submitCommand")(transport.submitCommand(request)),
  getReceipt: (operationId) => withDeadline("getReceipt")(transport.getReceipt(operationId)),
  pull: (request) => withDeadline("pull")(transport.pull(request)),
  acquireSnapshot: (request) => withDeadline("acquireSnapshot")(transport.acquireSnapshot(request)),
  readSnapshotPart: (snapshotId, partNumber) =>
    withDeadline("readSnapshotPart")(transport.readSnapshotPart(snapshotId, partNumber)),
});

export const makeSyncTransport = Effect.fn("Sync.makeTransport")(function* (baseUrl: string) {
  const client = yield* HttpApiClient.make(SyncHttpApi, {
    baseUrl,
    transformClient: honourRetryAfter,
  });
  return withRequestDeadlines({
    registerReplica: (request) =>
      mapTransportFailure(client.sync.registerReplica({ payload: request })),
    submitCommand: (request) =>
      mapTransportFailure(client.sync.submitCommand({ payload: request })),
    getReceipt: (operationId) =>
      mapTransportFailure(
        client.sync
          .getReceipt({ params: { operationId } })
          .pipe(Effect.catchTag("NotFound", () => Effect.succeed(undefined))),
      ),
    pull: (request) => mapTransportFailure(client.sync.pull({ payload: request })),
    acquireSnapshot: (request) =>
      mapTransportFailure(client.sync.acquireSnapshot({ payload: request })),
    readSnapshotPart: (snapshotId, partNumber) =>
      mapTransportFailure(client.sync.readSnapshotPart({ params: { snapshotId, partNumber } })),
  });
});

export class SyncTransportService extends Context.Service<SyncTransportService, SyncTransport>()(
  "@store/sync/SyncTransport",
) {
  static readonly layer = (baseUrl: string) =>
    Layer.effect(SyncTransportService, makeSyncTransport(baseUrl));
}
