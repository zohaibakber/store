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
  IndexedDbUpgradeBlocked,
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
  it("reads delay seconds", () => {
    expect(retryAfterMillis("120", NOW)).toBe(120_000);
  });

  it("reads an HTTP date", () => {
    expect(retryAfterMillis(new Date(NOW + 45_000).toUTCString(), NOW)).toBe(45_000);
  });

  it("clamps a past HTTP date to zero", () => {
    expect(retryAfterMillis(new Date(NOW - 45_000).toUTCString(), NOW)).toBe(0);
  });

  it("ignores an unparseable header", () => {
    expect(retryAfterMillis("soon", NOW)).toBeUndefined();
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

  it("maps a schema decode failure to a malformed failure", () => {
    const failure = schemaDecodeFailure();
    expect(failure).toBeInstanceOf(Schema.SchemaError);
    expect(failure && mapSyncFailure(failure, NOW)).toBeInstanceOf(SyncTransportInvalid);
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

  it("stops on a protocol error with no recovery path", () => {
    expect(dispositionFor(syncProtocolError("INSUFFICIENT_STOCK", "no stock"))._tag).toBe("stop");
  });

  it("surfaces a replica sequence gap as local corruption requiring recovery", () => {
    expect(dispositionFor(syncProtocolError("REPLICA_SEQUENCE_GAP", "gap"))).toEqual({
      _tag: "recoveryRequired",
      code: "REPLICA_SEQUENCE_GAP",
      message: "gap",
    });
  });

  it("routes SNAPSHOT_REQUIRED and INCARNATION_MISMATCH to recovery", () => {
    expect(dispositionFor(syncProtocolError("SNAPSHOT_REQUIRED", "behind"))._tag).toBe("recover");
    expect(dispositionFor(syncProtocolError("INCARNATION_MISMATCH", "reset"))._tag).toBe("recover");
  });

  it("classifies every replica storage failure as a terminal storage error", () => {
    const failures = [
      ReplicaStorageError.make({ message: "disk" }),
      IndexedDbUnavailable.make({ message: "unavailable" }),
      IndexedDbQuotaExceeded.make({ message: "quota" }),
      IndexedDbUpgradeBlocked.make({ message: "blocked" }),
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
