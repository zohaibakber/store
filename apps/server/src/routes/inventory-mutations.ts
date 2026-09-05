import { SYNC_BATCH_BYTES, type CatalogBatchResult } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { CurrentOrganization } from "../auth/organization";
import { StoreApi } from "../http/api";
import { badRequest, conflict, forbidden, payloadTooLarge } from "../http/errors";
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
    case "INSUFFICIENT_STOCK":
    case "INVOICE_IDENTITY_CONFLICT":
      return conflict(error.code, error.message);
    default:
      return badRequest(error.code, error.message);
  }
};

export const InventoryMutationHandlers = HttpApiBuilder.group(
  StoreApi,
  "inventoryMutations",
  Effect.fn("InventoryMutationHandlers.make")(function* (handlers) {
    const runtime = yield* ServerRuntime;

    return handlers
      .handle(
        "batch",
        Effect.fn("InventoryMutationHandlers.batch")(function* ({ payload }) {
          if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > SYNC_BATCH_BYTES) {
            return yield* Effect.fail(
              payloadTooLarge("BATCH_TOO_LARGE", "Sync batch exceeds 256 KiB."),
            );
          }
          const identity = yield* CurrentOrganization;
          const actor = { organizationId: identity.organizationId, userId: identity.user.id };
          const results: Array<CatalogBatchResult["results"][number]> = [];
          for (const entry of payload.commands) {
            const id =
              entry.kind === "catalogWrite" ? entry.command.operationId : entry.command.commandId;
            const operation = Effect.gen(function* () {
              const ack =
                entry.kind === "catalogWrite"
                  ? yield* runtime.writeInventoryMutation(actor, entry.command)
                  : entry.kind === "issueInvoice"
                    ? yield* runtime.issueInvoice(actor, entry.command)
                    : yield* runtime.importInventory(actor, entry.command);
              if (ack.txid === undefined)
                return yield* Effect.die(
                  new Error("A sync command committed without a replication receipt."),
                );
              return { txid: ack.txid };
            });
            const result = yield* operation.pipe(
              Effect.map((ack) => ({ status: "accepted" as const, id, txid: ack.txid })),
              Effect.catchTag("InventoryProtocolError", (error) =>
                Effect.succeed({
                  status: "rejected" as const,
                  id,
                  code: error.code,
                  message: error.message,
                }),
              ),
              Effect.catchTag("InventoryDatabaseError", Effect.die),
            );
            results.push(result);
            if (result.status === "rejected") break;
          }
          const cursor = Math.max(
            0,
            ...results.map((result) => (result.status === "accepted" ? result.txid : 0)),
          );
          if (cursor > 0) yield* runtime.notifyCatalog(identity.organizationId, cursor);
          return { results };
        }),
      )
      .handle(
        "write",
        Effect.fn("InventoryMutationHandlers.write")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* runtime
            .writeInventoryMutation(
              { organizationId: identity.organizationId, userId: identity.user.id },
              payload,
            )
            .pipe(
              Effect.tap((result) =>
                result.txid
                  ? runtime.notifyCatalog(identity.organizationId, result.txid)
                  : Effect.void,
              ),
              Effect.mapError((error) =>
                error._tag === "InventoryProtocolError" ? mutationProtocolError(error) : error,
              ),
              Effect.catchTag("InventoryDatabaseError", Effect.die),
            );
        }),
      )
      .handle(
        "importInventory",
        Effect.fn("InventoryMutationHandlers.importInventory")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* runtime
            .importInventory(
              { organizationId: identity.organizationId, userId: identity.user.id },
              payload,
            )
            .pipe(
              Effect.tap((result) =>
                result.txid
                  ? runtime.notifyCatalog(identity.organizationId, result.txid)
                  : Effect.void,
              ),
              Effect.mapError((error) =>
                error._tag === "InventoryProtocolError" ? mutationProtocolError(error) : error,
              ),
              Effect.catchTag("InventoryDatabaseError", Effect.die),
            );
        }),
      )
      .handle(
        "issueInvoice",
        Effect.fn("InventoryMutationHandlers.issueInvoice")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* runtime
            .issueInvoice(
              { organizationId: identity.organizationId, userId: identity.user.id },
              payload,
            )
            .pipe(
              Effect.tap((result) =>
                result.txid
                  ? runtime.notifyCatalog(identity.organizationId, result.txid)
                  : Effect.void,
              ),
              Effect.mapError((error) =>
                error._tag === "InventoryProtocolError" ? mutationProtocolError(error) : error,
              ),
              Effect.catchTag("InventoryDatabaseError", Effect.die),
            );
        }),
      )
      .handle(
        "pull",
        Effect.fn("InventoryMutationHandlers.pull")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* runtime
            .pullCatalog(identity.organizationId, payload)
            .pipe(Effect.catchTag("InventoryDatabaseError", Effect.die));
        }),
      )
      .handle(
        "snapshot",
        Effect.fn("InventoryMutationHandlers.snapshot")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* runtime
            .snapshotCatalog(identity.organizationId, payload)
            .pipe(Effect.catchTag("InventoryDatabaseError", Effect.die));
        }),
      );
  }),
);
