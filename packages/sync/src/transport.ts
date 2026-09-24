import type {
  AcquireSnapshotRequest,
  AcquireSnapshotResult,
  CommandReceipt,
  LiveTicket,
  LiveTicketRequest,
  RegisterReplicaRequest,
  RegisterReplicaResult,
  SnapshotId,
  SnapshotPartPayload,
  SyncCommandEnvelope,
  SyncPullRequest,
  SyncPullResult,
} from "@store/contracts";
import { SyncProtocolCode, SyncProtocolError } from "@store/contracts";
import { SyncHttpApi } from "@store/contracts/sync/api";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

import {
  isReplicaStorageFailure,
  ReplicaCoverageRepairRequired,
  SyncRecoveryRequired,
  type ReplicaStorageFailure,
} from "./replica/errors";

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

export class SyncTransportAuthRequired extends Schema.TaggedError<SyncTransportAuthRequired>()(
  "SyncTransportAuthRequired",
  {
    message: Schema.String,
    status: Schema.Number,
  },
) {}

export class SyncTransportInvalid extends Schema.TaggedError<SyncTransportInvalid>()(
  "SyncTransportInvalid",
  {
    message: Schema.String,
    status: OptionalNumber,
  },
) {}

export type SyncTransportError =
  | SyncTransportUnavailable
  | SyncTransportOffline
  | SyncTransportAuthRequired
  | SyncTransportInvalid;

export type SyncFailure = SyncTransportError | SyncProtocolError;

export type SyncCycleFailure =
  | SyncFailure
  | ReplicaStorageFailure
  | ReplicaCoverageRepairRequired
  | SyncRecoveryRequired;

export type SyncFailureDisposition =
  | { readonly _tag: "retry"; readonly delayMillis: number | undefined }
  | { readonly _tag: "pauseForAuth"; readonly status: number }
  | { readonly _tag: "stop"; readonly status: number | undefined; readonly message: string }
  | { readonly _tag: "recover"; readonly code: SyncProtocolCode }
  | { readonly _tag: "storageError"; readonly message: string }
  | {
      readonly _tag: "recoveryRequired";
      readonly code: SyncProtocolCode;
      readonly message: string;
    };

const RECOVERABLE_PROTOCOL_CODES: ReadonlySet<SyncProtocolCode> = new Set<SyncProtocolCode>([
  "EPOCH_MISMATCH",
  "INCARNATION_MISMATCH",
  "SNAPSHOT_REQUIRED",
]);

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
  if (status === 401 || status === 403) {
    return SyncTransportAuthRequired.make({ message, status });
  }
  if (status === 408 || status === 429 || status >= 500) {
    return SyncTransportUnavailable.make(
      retryAfter === undefined
        ? { message, status }
        : { message, status, retryAfterMillis: retryAfter },
    );
  }
  return SyncTransportInvalid.make({ message, status });
};

const fromTypedHttpError = (tag: string, code: string, message: string): SyncFailure => {
  const protocolCode = decodeProtocolCode(code);
  if (Option.isSome(protocolCode)) {
    return SyncProtocolError.make({ code: protocolCode.value, message });
  }
  return failureFromStatus(statusForErrorTag(tag), message);
};

const fromHttpClientError = (error: HttpClientError.HttpClientError, now: number): SyncFailure => {
  const reason = error.reason;
  if (reason._tag === "StatusCodeError") {
    const header = Headers.get(reason.response.headers, "retry-after");
    const delay = Option.isSome(header) ? retryAfterMillis(header.value, now) : undefined;
    return failureFromStatus(reason.response.status, error.message, delay);
  }
  if (reason._tag === "DecodeError" || reason._tag === "EmptyBodyError") {
    return SyncTransportInvalid.make({ message: error.message, status: reason.response.status });
  }
  return SyncTransportOffline.make({ message: error.message });
};

export const mapSyncFailure = (error: SyncFailureCause, now: number): SyncFailure => {
  if (error instanceof SyncProtocolError) return error;
  if (
    error instanceof SyncTransportUnavailable ||
    error instanceof SyncTransportOffline ||
    error instanceof SyncTransportAuthRequired ||
    error instanceof SyncTransportInvalid
  ) {
    return error;
  }
  if (HttpClientError.isHttpClientError(error)) return fromHttpClientError(error, now);
  if (error instanceof Schema.SchemaError) {
    return SyncTransportInvalid.make({ message: error.message });
  }
  const typed = decodeTypedHttpError(error);
  if (Option.isSome(typed)) {
    return fromTypedHttpError(typed.value._tag, typed.value.error.code, typed.value.error.message);
  }
  return SyncTransportOffline.make({
    message: error instanceof Error ? error.message : "The sync transport is unavailable.",
  });
};

export const classifySyncFailure = (error: SyncFailureCause, now: number): SyncCycleFailure =>
  isReplicaStorageFailure(error) ||
  error instanceof ReplicaCoverageRepairRequired ||
  error instanceof SyncRecoveryRequired
    ? error
    : mapSyncFailure(error, now);

export const dispositionFor = (error: SyncCycleFailure): SyncFailureDisposition => {
  if (isReplicaStorageFailure(error)) return { _tag: "storageError", message: error.message };
  if (error instanceof ReplicaCoverageRepairRequired) {
    return { _tag: "recover", code: "SNAPSHOT_REQUIRED" };
  }
  if (error instanceof SyncRecoveryRequired) {
    return { _tag: "recoveryRequired", code: error.code, message: error.message };
  }
  if (error instanceof SyncProtocolError) {
    if (error.code === "REPLICA_SEQUENCE_GAP") {
      return { _tag: "recoveryRequired", code: error.code, message: error.message };
    }
    return RECOVERABLE_PROTOCOL_CODES.has(error.code)
      ? { _tag: "recover", code: error.code }
      : { _tag: "stop", status: undefined, message: error.message };
  }
  if (error instanceof SyncTransportAuthRequired) {
    return { _tag: "pauseForAuth", status: error.status };
  }
  if (error instanceof SyncTransportInvalid) {
    return { _tag: "stop", status: error.status, message: error.message };
  }
  if (error instanceof SyncTransportUnavailable) {
    return { _tag: "retry", delayMillis: error.retryAfterMillis };
  }
  return { _tag: "retry", delayMillis: undefined };
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
    envelope: SyncCommandEnvelope,
  ) => Effect.Effect<CommandReceipt, SyncTransportError | SyncProtocolError>;
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
  readonly mintLiveTicket: (
    request: LiveTicketRequest,
  ) => Effect.Effect<LiveTicket, SyncTransportError | SyncProtocolError>;
};

export const makeSyncTransport = Effect.fn("Sync.makeTransport")(function* (baseUrl: string) {
  const client = yield* HttpApiClient.make(SyncHttpApi, { baseUrl });
  return {
    registerReplica: (request) =>
      mapTransportFailure(client.sync.registerReplica({ payload: request })),
    submitCommand: (envelope) =>
      mapTransportFailure(client.sync.submitCommand({ payload: envelope })),
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
    mintLiveTicket: (request) =>
      mapTransportFailure(client.sync.mintLiveTicket({ payload: request })),
  } satisfies SyncTransport;
});

export class SyncTransportService extends Context.Service<SyncTransportService, SyncTransport>()(
  "@store/sync/SyncTransport",
) {
  static readonly layer = (baseUrl: string) =>
    Layer.effect(SyncTransportService, makeSyncTransport(baseUrl));
}
