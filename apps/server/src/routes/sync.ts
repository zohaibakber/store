import { SyncNotFound } from "@store/contracts/sync/http-errors";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { CurrentOrganization, type CurrentOrganizationContext } from "../auth/organization";
import { StoreApi } from "../http/api";
import { mapSyncError } from "../http/sync-errors";
import type { InventorySyncActor } from "../inventory/model";
import {
  SyncAuthority,
  SyncLiveUpgrade,
  type SyncAuthorityError,
} from "../inventory/sync-authority";

const prefersEventStream = (accept: string | undefined): boolean =>
  accept !== undefined &&
  accept.split(",").some((part) => part.trim().toLowerCase().startsWith("text/event-stream"));

const syncActor = (identity: CurrentOrganizationContext): InventorySyncActor => ({
  organizationId: identity.organizationId,
  userId: identity.user.id,
  authorizationExpiresAt: identity.session.expiresAt,
});

const asActor = <A, R>(
  span: string,
  run: (actor: InventorySyncActor) => Effect.Effect<A, SyncAuthorityError, R>,
) =>
  CurrentOrganization.pipe(
    Effect.flatMap((identity) => run(syncActor(identity))),
    Effect.mapError(mapSyncError),
    Effect.withSpan(`SyncHandlers.${span}`),
  );

export const SyncHandlers = HttpApiBuilder.group(
  StoreApi,
  "sync",
  Effect.fn("SyncHandlers.make")(function* (handlers) {
    const authority = yield* SyncAuthority;
    const liveUpgrade = yield* SyncLiveUpgrade;

    return handlers
      .handle("registerReplica", ({ payload }) =>
        asActor("registerReplica", (actor) => authority.registerReplica(actor, payload)),
      )
      .handle("submitCommand", ({ payload }) =>
        asActor("submitCommand", (actor) => authority.submitCommand(actor, payload)),
      )
      .handle("getReceipt", ({ params }) =>
        asActor("getReceipt", (actor) => authority.getReceipt(actor, params.operationId)).pipe(
          Effect.flatMap((receipt) =>
            receipt
              ? Effect.succeed(receipt)
              : Effect.fail(
                  SyncNotFound.make({
                    error: { code: "RECEIPT_NOT_FOUND", message: "No receipt for that command." },
                  }),
                ),
          ),
        ),
      )
      .handle("pull", ({ payload }) => asActor("pull", (actor) => authority.pull(actor, payload)))
      .handle("acquireSnapshot", ({ payload }) =>
        asActor("acquireSnapshot", (actor) => authority.acquireSnapshot(actor, payload)),
      )
      .handle("readSnapshotPart", ({ params }) =>
        asActor("readSnapshotPart", (actor) =>
          authority.readSnapshotPart(actor, params.snapshotId, params.partNumber),
        ),
      )
      .handle("mintLiveTicket", ({ payload }) =>
        asActor("mintLiveTicket", (actor) => authority.mintLiveTicket(actor, payload)),
      )
      .handle("liveUpgrade", ({ query, request }) =>
        asActor("liveUpgrade", (actor) =>
          liveUpgrade.handle(actor, query, prefersEventStream(request.headers.accept)),
        ),
      );
  }),
);
