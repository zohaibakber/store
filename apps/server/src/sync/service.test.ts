import { assert, describe, layer } from "@effect/vitest";
import {
  SyncOperation,
  SyncRequest,
  type SyncEntityChange,
  type SyncResponse,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { operationPayloadHash } from "./hash";
import { SyncDatabase, syncProgram, syncServiceLayer, type SyncActor } from "./service";

const actor: SyncActor = { organizationId: "org-1", userId: "user-1" };

const requestFor = (): SyncRequest => {
  const operation = {
    operationId: "operation-1",
    organizationId: actor.organizationId,
    deviceId: "device-1",
    actorUserId: actor.userId,
    clientSequence: 1,
    occurredAt: 1_750_000_000_000,
    payloadHash: "",
    changes: [
      {
        entity: "category",
        action: "upsert",
        entityId: "general",
        rowVersion: 1,
        row: { id: "general", name: "General" },
      },
    ] satisfies ReadonlyArray<SyncEntityChange>,
  };
  return SyncRequest.make({
    organizationId: actor.organizationId,
    deviceId: operation.deviceId,
    cursor: 0,
    operations: [{ ...operation, payloadHash: operationPayloadHash(operation) }],
  });
};

const firstOperation = (request: SyncRequest): SyncOperation => {
  const operation = request.operations[0];
  if (!operation) throw new Error("The test request must contain an operation.");
  return operation;
};

const responseFor = (request: SyncRequest): SyncResponse => ({
  organizationId: actor.organizationId,
  cursor: request.cursor,
  hasMore: false,
  acknowledgements: [],
  changes: [],
});

const databaseLayer = Layer.succeed(SyncDatabase, {
  exchange: (_identity, request) => Effect.succeed(responseFor(request)),
});
const testLayer = syncServiceLayer.pipe(Layer.provide(databaseLayer));

describe("SyncService", () => {
  layer(testLayer)((it) => {
    it.effect("passes a valid, integrity-checked request to the database service", () =>
      Effect.gen(function* () {
        const request = requestFor();
        const response = yield* syncProgram(actor, request);
        assert.deepStrictEqual(response, responseFor(request));
      }),
    );

    it.effect("rejects organization and actor claims that differ from authenticated identity", () =>
      Effect.gen(function* () {
        const source = requestFor();
        const organizationMismatch = SyncRequest.make({
          organizationId: "org-other",
          deviceId: source.deviceId,
          cursor: source.cursor,
          operations: source.operations,
        });
        const organizationResult = yield* Effect.result(syncProgram(actor, organizationMismatch));
        assert.strictEqual(organizationResult._tag, "Failure");
        if (organizationResult._tag === "Failure") {
          assert.strictEqual(organizationResult.failure._tag, "SyncProtocolError");
          if (organizationResult.failure._tag === "SyncProtocolError")
            assert.strictEqual(organizationResult.failure.code, "ORGANIZATION_MISMATCH");
        }

        const request = requestFor();
        const sourceOperation = firstOperation(request);
        const operation = SyncOperation.make({
          operationId: sourceOperation.operationId,
          organizationId: sourceOperation.organizationId,
          deviceId: sourceOperation.deviceId,
          actorUserId: "user-other",
          clientSequence: sourceOperation.clientSequence,
          occurredAt: sourceOperation.occurredAt,
          payloadHash: "",
          changes: sourceOperation.changes,
        });
        const hashedOperation = SyncOperation.make({
          operationId: operation.operationId,
          organizationId: operation.organizationId,
          deviceId: operation.deviceId,
          actorUserId: operation.actorUserId,
          clientSequence: operation.clientSequence,
          occurredAt: operation.occurredAt,
          payloadHash: operationPayloadHash(operation),
          changes: operation.changes,
        });
        const actorMismatch = SyncRequest.make({
          organizationId: request.organizationId,
          deviceId: request.deviceId,
          cursor: request.cursor,
          operations: [hashedOperation],
        });
        const actorResult = yield* Effect.result(syncProgram(actor, actorMismatch));
        assert.strictEqual(actorResult._tag, "Failure");
        if (actorResult._tag === "Failure") {
          assert.strictEqual(actorResult.failure._tag, "SyncProtocolError");
          if (actorResult.failure._tag === "SyncProtocolError")
            assert.strictEqual(actorResult.failure.code, "ACTOR_MISMATCH");
        }
      }),
    );

    it.effect("rejects operation content that does not match its stable payload hash", () =>
      Effect.gen(function* () {
        const request = requestFor();
        const sourceOperation = firstOperation(request);
        const tamperedOperation = SyncOperation.make({
          operationId: sourceOperation.operationId,
          organizationId: sourceOperation.organizationId,
          deviceId: sourceOperation.deviceId,
          actorUserId: sourceOperation.actorUserId,
          clientSequence: sourceOperation.clientSequence,
          occurredAt: 1,
          payloadHash: "0".repeat(64),
          changes: sourceOperation.changes,
        });
        const tampered = SyncRequest.make({
          organizationId: request.organizationId,
          deviceId: request.deviceId,
          cursor: request.cursor,
          operations: [tamperedOperation],
        });
        const result = yield* Effect.result(syncProgram(actor, tampered));
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.strictEqual(result.failure._tag, "SyncProtocolError");
          if (result.failure._tag === "SyncProtocolError")
            assert.strictEqual(result.failure.code, "PAYLOAD_HASH_MISMATCH");
        }
      }),
    );
  });
});
