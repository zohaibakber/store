import { SyncNotFound } from "@store/contracts/sync/http-errors";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { CurrentOrganization } from "../auth/organization";
import { StoreApi } from "../http/api";
import { mapSyncError } from "../http/sync-errors";
import type { InventorySyncActor } from "../inventory/model";
import { SyncAuthority, SyncLiveUpgrade } from "../inventory/sync-authority";

export const prefersEventStream = (accept: string | undefined): boolean => {
  if (accept === undefined) return false;
  return accept
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .some((part) => part.startsWith("text/event-stream"));
};

export const syncActor = (identity: {
  readonly organizationId: string;
  readonly user: { readonly id: string };
  readonly session: { readonly expiresAt: number };
}): InventorySyncActor => ({
  organizationId: identity.organizationId,
  userId: identity.user.id,
  authorizationExpiresAt: identity.session.expiresAt,
});

export const SyncHandlers = HttpApiBuilder.group(
  StoreApi,
  "sync",
  Effect.fn("SyncHandlers.make")(function* (handlers) {
    const authority = yield* SyncAuthority;
    const liveUpgrade = yield* SyncLiveUpgrade;

    return handlers
      .handle(
        "registerReplica",
        Effect.fn("SyncHandlers.registerReplica")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* authority
            .registerReplica(syncActor(identity), payload)
            .pipe(Effect.mapError(mapSyncError));
        }),
      )
      .handle(
        "submitCommand",
        Effect.fn("SyncHandlers.submitCommand")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* authority
            .submitCommand(syncActor(identity), payload)
            .pipe(Effect.mapError(mapSyncError));
        }),
      )
      .handle(
        "getReceipt",
        Effect.fn("SyncHandlers.getReceipt")(function* ({ params }) {
          const identity = yield* CurrentOrganization;
          const receipt = yield* authority
            .getReceipt(syncActor(identity), params.operationId)
            .pipe(Effect.mapError(mapSyncError));
          if (!receipt) {
            return yield* Effect.fail(
              SyncNotFound.make({
                error: { code: "RECEIPT_NOT_FOUND", message: "No receipt for that command." },
              }),
            );
          }
          return receipt;
        }),
      )
      .handle(
        "pull",
        Effect.fn("SyncHandlers.pull")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* authority
            .pull(syncActor(identity), payload)
            .pipe(Effect.mapError(mapSyncError));
        }),
      )
      .handle(
        "acquireSnapshot",
        Effect.fn("SyncHandlers.acquireSnapshot")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* authority
            .acquireSnapshot(syncActor(identity), payload)
            .pipe(Effect.mapError(mapSyncError));
        }),
      )
      .handle(
        "readSnapshotPart",
        Effect.fn("SyncHandlers.readSnapshotPart")(function* ({ params }) {
          const identity = yield* CurrentOrganization;
          return yield* authority
            .readSnapshotPart(syncActor(identity), params.snapshotId, params.partNumber)
            .pipe(Effect.mapError(mapSyncError));
        }),
      )
      .handle(
        "mintLiveTicket",
        Effect.fn("SyncHandlers.mintLiveTicket")(function* ({ payload }) {
          const identity = yield* CurrentOrganization;
          return yield* authority
            .mintLiveTicket(syncActor(identity), payload)
            .pipe(Effect.mapError(mapSyncError));
        }),
      )
      .handle(
        "liveUpgrade",
        Effect.fn("SyncHandlers.liveUpgrade")(function* ({ query, request }) {
          const identity = yield* CurrentOrganization;
          return yield* liveUpgrade
            .handle(syncActor(identity), query, prefersEventStream(request.headers.accept))
            .pipe(Effect.mapError(mapSyncError));
        }),
      );
  }),
);
