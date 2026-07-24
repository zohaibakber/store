import {
  MAX_SYNC_CHANGES_PER_REQUEST,
  MAX_SYNC_OPERATIONS_PER_REQUEST,
  type SyncRequest,
  type SyncResponse,
} from "@store/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { SyncDatabase } from "./database.service";
import { protocolError, type SyncDatabaseError, type SyncProtocolError } from "./errors";
import { operationPayloadHash } from "./hash";
import type { SyncActor } from "./model";

export type { SyncActor } from "./model";
export { SyncDatabase } from "./database.service";
export { SyncDatabaseError, SyncProtocolError } from "./errors";

export class SyncService extends Context.Service<
  SyncService,
  {
    readonly exchange: (
      actor: SyncActor,
      request: SyncRequest,
    ) => Effect.Effect<SyncResponse, SyncDatabaseError | SyncProtocolError>;
  }
>()("@store/server/SyncService") {}

const invalid = (code: string, message: string) => protocolError(code, message);

const validIdentifier = (value: string) => value.length > 0 && value.length <= 200;

export const syncServiceLayer = Layer.effect(
  SyncService,
  Effect.gen(function* () {
    const database = yield* SyncDatabase;
    const exchange = Effect.fn("SyncService.exchange")(function* (
      actor: SyncActor,
      request: SyncRequest,
    ) {
      if (request.organizationId !== actor.organizationId)
        return yield* invalid(
          "ORGANIZATION_MISMATCH",
          "The sync request does not belong to the active organization.",
        );
      if (!validIdentifier(request.deviceId))
        return yield* invalid("INVALID_DEVICE", "The sync device id is invalid.");
      if (!Number.isSafeInteger(request.cursor) || request.cursor < 0)
        return yield* invalid("INVALID_CURSOR", "The sync cursor must be a non-negative integer.");
      if (request.operations.length > MAX_SYNC_OPERATIONS_PER_REQUEST)
        return yield* invalid(
          "TOO_MANY_OPERATIONS",
          `A sync request may contain at most ${MAX_SYNC_OPERATIONS_PER_REQUEST} operations.`,
        );
      let changeCount = 0;
      const operationIds = new Set<string>();
      for (const operation of request.operations) {
        if (!validIdentifier(operation.operationId))
          return yield* invalid("INVALID_OPERATION", "A sync operation id is invalid.");
        if (!Number.isSafeInteger(operation.clientSequence) || operation.clientSequence < 1)
          return yield* invalid(
            "INVALID_CLIENT_SEQUENCE",
            "A client sequence must be a positive integer.",
          );
        if (!Number.isSafeInteger(operation.occurredAt) || operation.occurredAt < 1)
          return yield* invalid("INVALID_OCCURRED_AT", "An operation timestamp is invalid.");
        if (!/^[0-9a-f]{64}$/.test(operation.payloadHash))
          return yield* invalid("INVALID_PAYLOAD_HASH", "An operation payload hash is invalid.");
        if (operation.changes.length === 0)
          return yield* invalid("EMPTY_OPERATION", "A sync operation must contain a change.");
        changeCount += operation.changes.length;
        if (changeCount > MAX_SYNC_CHANGES_PER_REQUEST)
          return yield* invalid(
            "TOO_MANY_CHANGES",
            `A sync request may contain at most ${MAX_SYNC_CHANGES_PER_REQUEST} changes.`,
          );
        if (operationIds.has(operation.operationId))
          return yield* invalid(
            "DUPLICATE_OPERATION",
            "Each operation may appear only once in a sync request.",
          );
        operationIds.add(operation.operationId);
        if (operation.organizationId !== actor.organizationId)
          return yield* invalid(
            "ORGANIZATION_MISMATCH",
            "A sync operation does not belong to the active organization.",
          );
        if (operation.actorUserId !== actor.userId)
          return yield* invalid(
            "ACTOR_MISMATCH",
            "A sync operation was created by a different user.",
          );
        if (operation.deviceId !== request.deviceId)
          return yield* invalid(
            "DEVICE_MISMATCH",
            "A sync operation does not belong to the requesting device.",
          );
        for (const change of operation.changes) {
          if (!validIdentifier(change.entityId))
            return yield* invalid("INVALID_ENTITY_ID", "A sync entity id is invalid.");
          if (!Number.isSafeInteger(change.rowVersion) || change.rowVersion < 1)
            return yield* invalid(
              "INVALID_ROW_VERSION",
              "A row version must be a positive integer.",
            );
        }
        if (operationPayloadHash(operation) !== operation.payloadHash)
          return yield* invalid(
            "PAYLOAD_HASH_MISMATCH",
            "A sync operation failed its integrity check.",
          );
      }
      return yield* database.exchange(actor, request);
    });
    return SyncService.of({ exchange });
  }),
);

export const syncProgram = (actor: SyncActor, request: SyncRequest) =>
  Effect.flatMap(SyncService, (service) => service.exchange(actor, request));
