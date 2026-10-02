import { syncProtocolError } from "@store/contracts";
import * as Schema from "effect/Schema";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { describe, expect, it } from "vitest";

import {
  IndexedDbCorruptRecord,
  IndexedDbIdentityMismatch,
  IndexedDbQuotaExceeded,
  IndexedDbUnavailable,
  ReplicaStorageError,
} from "../src/replica/errors";
import {
  classifySyncFailure,
  dispositionFor,
  mapSyncFailure,
  retryAfterMillis,
  SyncTransportAuthRequired,
  SyncTransportInvalid,
  SyncTransportOffline,
  SyncTransportUnavailable,
  SyncTransportUndecodable,
} from "../src/transport";

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);

const request = HttpClientRequest.post("https://api.example.test/api/sync/pull");

const statusFailure = (status: number, headers: Record<string, string>) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.StatusCodeError({
      request,
      response: HttpClientResponse.fromWeb(request, new Response(null, { status, headers })),
    }),
  });

const schemaDecodeFailure = (): Schema.SchemaError | undefined => {
  try {
    Schema.decodeUnknownSync(Schema.Struct({ epoch: Schema.String }))({});
  } catch (error) {
    return error instanceof Schema.SchemaError ? error : undefined;
  }
  return undefined;
};

describe("retry-after parsing", () => {
  it.each([
    ["delay seconds", "120", 120_000],
    ["an HTTP date", new Date(NOW + 45_000).toUTCString(), 45_000],
    ["a past HTTP date clamped to zero", new Date(NOW - 45_000).toUTCString(), 0],
    ["an unparseable header", "soon", undefined],
  ])("reads %s", (_name, header, expected) => {
    expect(retryAfterMillis(header, NOW)).toBe(expected);
  });
});

describe("transport failure taxonomy", () => {
  it("maps 503 with Retry-After to a retryable failure carrying the delay", () => {
    const failure = mapSyncFailure(statusFailure(503, { "retry-after": "30" }), NOW);
    expect(failure).toBeInstanceOf(SyncTransportUnavailable);
    expect(dispositionFor(failure)).toEqual({ _tag: "retry", delayMillis: 30_000 });
  });

  it("maps 401 and 403 to an auth pause", () => {
    const unauthorized = mapSyncFailure(statusFailure(401, {}), NOW);
    const forbidden = mapSyncFailure(statusFailure(403, {}), NOW);
    expect(unauthorized).toBeInstanceOf(SyncTransportAuthRequired);
    expect(dispositionFor(forbidden)).toEqual({ _tag: "pauseForAuth", status: 403 });
  });

  it("maps a response decode failure to a malformed failure that stops the loop", () => {
    const failure = mapSyncFailure(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.DecodeError({
          request,
          response: HttpClientResponse.fromWeb(request, new Response("{}", { status: 200 })),
        }),
      }),
      NOW,
    );
    expect(failure).toBeInstanceOf(SyncTransportInvalid);
    expect(dispositionFor(failure)._tag).toBe("stop");
  });

  it("maps a schema decode failure to an undecodable failure that asks for an update", () => {
    const failure = schemaDecodeFailure();
    expect(failure).toBeInstanceOf(Schema.SchemaError);
    const mapped = failure && mapSyncFailure(failure, NOW);
    expect(mapped).toBeInstanceOf(SyncTransportUndecodable);
    expect(mapped && dispositionFor(mapped)._tag).toBe("updateRequired");
  });

  it("maps a transport error to an offline failure that retries", () => {
    const failure = mapSyncFailure(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({ request, description: "offline" }),
      }),
      NOW,
    );
    expect(failure).toBeInstanceOf(SyncTransportOffline);
    expect(dispositionFor(failure)).toEqual({ _tag: "retry", delayMillis: undefined });
  });

  it("recovers a typed protocol error body from the HTTP error channel", () => {
    const failure = mapSyncFailure(
      { _tag: "Conflict", error: { code: "EPOCH_MISMATCH", message: "stale epoch" } },
      NOW,
    );
    expect(dispositionFor(failure)).toEqual({ _tag: "recover", code: "EPOCH_MISMATCH" });
  });

  it.each([
    ["INSUFFICIENT_STOCK", { _tag: "stop", status: undefined, message: "failure" }],
    [
      "REPLICA_SEQUENCE_GAP",
      { _tag: "recoveryRequired", code: "REPLICA_SEQUENCE_GAP", message: "failure" },
    ],
    ["SNAPSHOT_REQUIRED", { _tag: "recover", code: "SNAPSHOT_REQUIRED" }],
    ["INCARNATION_MISMATCH", { _tag: "recover", code: "INCARNATION_MISMATCH" }],
  ] as const)("routes a %s protocol error", (code, disposition) => {
    expect(dispositionFor(syncProtocolError(code, "failure"))).toEqual(disposition);
  });

  it("classifies every replica storage failure as a terminal storage error", () => {
    const failures = [
      ReplicaStorageError.make({ message: "disk" }),
      IndexedDbUnavailable.make({ message: "unavailable" }),
      IndexedDbQuotaExceeded.make({ message: "quota" }),
      IndexedDbCorruptRecord.make({ message: "corrupt", store: "command_outbox" }),
      IndexedDbIdentityMismatch.make({
        message: "identity",
        expectedOrganizationId: "org",
        expectedUserId: "user",
      }),
    ];
    for (const failure of failures) {
      expect(dispositionFor(classifySyncFailure(failure, 0))).toEqual({
        _tag: "storageError",
        message: failure.message,
      });
    }
  });
});
