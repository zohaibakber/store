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
import { SyncTransportUnavailable, type SyncTransport } from "@store/sync";
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
  return SyncTransportUnavailable.make({
    message: `Sync request failed with status ${status}.`,
  });
};

const decodeJson = <A, I>(schema: Schema.Codec<A, I>, bodyText: string): A =>
  Schema.decodeUnknownSync(Schema.fromJsonString(schema))(bodyText);

const encodeJsonBody = Schema.encodeSync(Schema.fromJsonString(Schema.Json));

export const makeProxySyncTransport = (proxyFetch: SyncProxyFetch): SyncTransport => {
  const postJson = <A, I>(pathname: string, schema: Schema.Codec<A, I>, payload: SyncProxyPostBody) =>
    Effect.tryPromise({
      try: async () => {
        const result = await proxyFetch(
          "POST",
          pathname,
          encodeJsonBody(payload as typeof Schema.Json.Type),
        );
        if (!result.ok) throw mapHttpFailure(result.status, result.bodyText);
        return decodeJson(schema, result.bodyText);
      },
      catch: (cause) =>
        cause instanceof SyncProtocolError || cause instanceof SyncTransportUnavailable
          ? cause
          : SyncTransportUnavailable.make({
              message:
                cause instanceof Error ? cause.message : "The sync transport is unavailable.",
            }),
    });

  return {
    registerReplica: (request) => postJson("/api/sync/replicas", RegisterReplicaResult, request),
    submitCommand: (envelope) => postJson("/api/sync/commands", CommandReceipt, envelope),
    getReceipt: (operationId) =>
      Effect.tryPromise({
        try: async () => {
          const result = await proxyFetch(
            "GET",
            `/api/sync/receipts/${encodeURIComponent(operationId)}`,
            null,
          );
          if (result.status === 404) return undefined;
          if (!result.ok) throw mapHttpFailure(result.status, result.bodyText);
          return decodeJson(CommandReceipt, result.bodyText);
        },
        catch: (cause) =>
          cause instanceof SyncProtocolError || cause instanceof SyncTransportUnavailable
            ? cause
            : SyncTransportUnavailable.make({
                message:
                  cause instanceof Error ? cause.message : "The sync transport is unavailable.",
              }),
      }),
    pull: (request) => postJson("/api/sync/pull", SyncPullResult, request),
    acquireSnapshot: (request) => postJson("/api/sync/snapshots", AcquireSnapshotResult, request),
    readSnapshotPart: (snapshotId, partNumber) =>
      Effect.tryPromise({
        try: async () => {
          const result = await proxyFetch(
            "GET",
            `/api/sync/snapshots/${encodeURIComponent(snapshotId)}/parts/${partNumber}`,
            null,
          );
          if (!result.ok) throw mapHttpFailure(result.status, result.bodyText);
          return decodeJson(SnapshotPartPayload, result.bodyText);
        },
        catch: (cause) =>
          cause instanceof SyncProtocolError || cause instanceof SyncTransportUnavailable
            ? cause
            : SyncTransportUnavailable.make({
                message:
                  cause instanceof Error ? cause.message : "The sync transport is unavailable.",
              }),
      }),
    mintLiveTicket: (request) => postJson("/api/sync/live-tickets", LiveTicket, request),
  };
};
