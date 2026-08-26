import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { CurrentOrganization, type CurrentOrganizationContext } from "../auth/organization";
import { StoreApi } from "../http/api";
import { badGateway, badRequest, conflict, forbidden, notFound } from "../http/errors";
import { ServerRuntime } from "../http/runtime";
import type { InventoryProtocolError } from "../inventory/errors";

const requireLegacyCatalogAdmin = (identity: CurrentOrganizationContext) => {
  if (identity.role === "owner" || identity.role === "admin") return Effect.void;
  return Effect.fail(
    forbidden(
      "LEGACY_CATALOG_FORBIDDEN",
      "Only owners and admins can upload or reconcile a legacy catalog.",
    ),
  );
};

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
          yield* requireLegacyCatalogAdmin(identity);
          return yield* runtime
            .startLegacyCatalogMigration(
              { organizationId: identity.organizationId, userId: identity.user.id },
              payload,
            )
            .pipe(
              Effect.catchTag("LegacyMigrationQueueError", (error) =>
                Effect.fail(badGateway("LEGACY_MIGRATION_QUEUE_UNAVAILABLE", error.message)),
              ),
              Effect.catchTag("InventoryDatabaseError", Effect.die),
            );
        }),
      )
      .handle(
        "legacyCatalogMigrationStatus",
        Effect.fn("ElectricMutationHandlers.legacyCatalogMigrationStatus")(function* ({ params }) {
          const identity = yield* CurrentOrganization;
          yield* requireLegacyCatalogAdmin(identity);
          const status = yield* runtime
            .getLegacyCatalogMigration(
              { organizationId: identity.organizationId, userId: identity.user.id },
              params.jobId,
            )
            .pipe(Effect.catchTag("InventoryDatabaseError", Effect.die));
          if (status) return status;
          return yield* Effect.fail(
            notFound("LEGACY_MIGRATION_NOT_FOUND", "Migration job not found."),
          );
        }),
      )
      .handle(
        "migrateLegacyCatalogBatch",
        Effect.fn("ElectricMutationHandlers.migrateLegacyCatalogBatch")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          yield* requireLegacyCatalogAdmin(identity);
          return yield* runtime
            .migrateLegacyCatalogBatch(
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
          yield* requireLegacyCatalogAdmin(identity);
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
