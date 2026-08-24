import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { CurrentOrganization } from "../auth/organization";
import { StoreApi } from "../http/api";
import { badRequest, conflict, forbidden } from "../http/errors";
import { ServerRuntime } from "../http/runtime";
import type { InventoryProtocolError } from "../inventory/errors";

const mutationProtocolError = (error: InventoryProtocolError) => {
  switch (error.code) {
    case "ORGANIZATION_MISMATCH":
    case "ACTOR_MISMATCH":
      return forbidden(error.code, error.message);
    case "OPERATION_ID_REUSED":
    case "DUPLICATE_OPERATION":
    case "ENTITY_CONFLICT":
    case "ENTITY_RELATION_INVALID":
      return conflict(error.code, error.message);
    default:
      return badRequest(error.code, error.message);
  }
};

export const ElectricMutationHandlers = HttpApiBuilder.group(
  StoreApi,
  "electricMutations",
  Effect.fn("ElectricMutationHandlers.make")(function* (handlers) {
    const runtime = yield* ServerRuntime;

    return handlers
      .handle(
        "write",
        Effect.fn("ElectricMutationHandlers.write")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* runtime
            .writeElectricMutation(
              { organizationId: identity.organizationId, userId: identity.user.id },
              payload.operation,
            )
            .pipe(
              Effect.mapError((error) =>
                error._tag === "InventoryProtocolError" ? mutationProtocolError(error) : error,
              ),
              Effect.catchTag("InventoryDatabaseError", Effect.die),
            );
        }),
      )
      .handle(
        "importInventory",
        Effect.fn("ElectricMutationHandlers.importInventory")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* runtime
            .importInventory(
              { organizationId: identity.organizationId, userId: identity.user.id },
              payload,
            )
            .pipe(
              Effect.mapError((error) =>
                error._tag === "InventoryProtocolError" ? mutationProtocolError(error) : error,
              ),
              Effect.catchTag("InventoryDatabaseError", Effect.die),
            );
        }),
      )
      .handle(
        "issueInvoice",
        Effect.fn("ElectricMutationHandlers.issueInvoice")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* runtime
            .issueInvoice(
              { organizationId: identity.organizationId, userId: identity.user.id },
              payload,
            )
            .pipe(
              Effect.mapError((error) =>
                error._tag === "InventoryProtocolError" ? mutationProtocolError(error) : error,
              ),
              Effect.catchTag("InventoryDatabaseError", Effect.die),
            );
        }),
      )
      .handle(
        "migrateLegacyCatalog",
        Effect.fn("ElectricMutationHandlers.migrateLegacyCatalog")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* runtime
            .migrateLegacyCatalog(
              { organizationId: identity.organizationId, userId: identity.user.id },
              payload,
            )
            .pipe(
              Effect.mapError((error) =>
                error._tag === "InventoryProtocolError" ? mutationProtocolError(error) : error,
              ),
              Effect.catchTag("InventoryDatabaseError", Effect.die),
            );
        }),
      )
      .handle(
        "reconcileLegacyCatalog",
        Effect.fn("ElectricMutationHandlers.reconcileLegacyCatalog")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* runtime
            .reconcileLegacyCatalog(
              { organizationId: identity.organizationId, userId: identity.user.id },
              payload,
            )
            .pipe(
              Effect.mapError((error) =>
                error._tag === "InventoryProtocolError" ? mutationProtocolError(error) : error,
              ),
              Effect.catchTag("InventoryDatabaseError", Effect.die),
            );
        }),
      );
  }),
);
