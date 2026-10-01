import { MAX_IMPORT_PART_BYTES } from "@store/contracts";
import { SyncForbidden, SyncNotFound } from "@store/contracts/sync/http-errors";
import * as Effect from "effect/Effect";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { CurrentOrganization, type CurrentOrganizationContext } from "../auth/organization";
import { StoreApi } from "../http/api";
import { publicError } from "../http/errors";
import { mapSyncError } from "../http/sync-errors";
import { MAX_SUBMIT_BODY_BYTES } from "../inventory/commands";
import type { EncodedSnapshotPart, InventoryActor } from "../inventory/model";
import { SyncAuthority, type SyncAuthorityError } from "../inventory/sync-authority";
import { LiveFanout } from "../live/fanout";

const SNAPSHOT_PART_CACHE_CONTROL = "private, max-age=31536000, immutable";

const encodedJsonResponse = (json: string, headers?: Record<string, string>) =>
  HttpServerResponse.text(json, { contentType: "application/json", headers });

const entityTag = (sha256: string) => `"${sha256}"`;

const matchesEntityTag = (ifNoneMatch: string | undefined, tag: string): boolean =>
  ifNoneMatch !== undefined &&
  ifNoneMatch
    .split(",")
    .map((candidate) => candidate.trim().replace(/^W\//u, ""))
    .some((candidate) => candidate === "*" || candidate === tag);

const snapshotPartResponse = (part: EncodedSnapshotPart, ifNoneMatch: string | undefined) => {
  const tag = entityTag(part.sha256);
  const headers = { etag: tag, "cache-control": SNAPSHOT_PART_CACHE_CONTROL };
  return matchesEntityTag(ifNoneMatch, tag)
    ? HttpServerResponse.empty({ status: 304, headers })
    : encodedJsonResponse(part.json, headers);
};

const malformedCommandResponse = HttpServerResponse.empty({ status: 400 });

const commandTooLargeResponse = () =>
  HttpServerResponse.jsonUnsafe(
    publicError("COMMAND_TOO_LARGE", "The command is too large to submit."),
    { status: 413 },
  );

const importPartTooLargeResponse = () =>
  HttpServerResponse.jsonUnsafe(
    publicError("IMPORT_PART_TOO_LARGE", "The import part is too large to store."),
    { status: 413 },
  );

const utf8 = new TextDecoder();

const declaresOversizedBody = (request: HttpServerRequest.HttpServerRequest, maxBytes: number) => {
  const declared = Number(request.headers["content-length"]);
  return Number.isFinite(declared) && declared > maxBytes;
};

const boundedBodyText = (request: HttpServerRequest.HttpServerRequest, maxBytes: number) =>
  declaresOversizedBody(request, maxBytes)
    ? Effect.succeed(undefined)
    : request.arrayBuffer.pipe(
        Effect.orDie,
        Effect.map((buffer) => (buffer.byteLength > maxBytes ? undefined : utf8.decode(buffer))),
      );

const syncActor = (identity: CurrentOrganizationContext): InventoryActor => ({
  organizationId: identity.organizationId,
  userId: identity.user.id,
});

const asActor = <A, R>(
  span: string,
  run: (actor: InventoryActor) => Effect.Effect<A, SyncAuthorityError, R>,
) =>
  CurrentOrganization.pipe(
    Effect.flatMap((identity) => run(syncActor(identity))),
    Effect.mapError(mapSyncError),
    Effect.withSpan(`SyncHandlers.${span}`),
  );

const ownerRequired = SyncForbidden.make(
  publicError("OWNER_REQUIRED", "Only an owner can move a device's data into this organization."),
);

const asOwner = <A, R>(
  span: string,
  run: (actor: InventoryActor) => Effect.Effect<A, SyncAuthorityError, R>,
) =>
  CurrentOrganization.pipe(
    Effect.flatMap((identity) =>
      identity.role === "owner"
        ? Effect.mapError(run(syncActor(identity)), mapSyncError)
        : Effect.fail(ownerRequired),
    ),
    Effect.withSpan(`SyncHandlers.${span}`),
  );

export const SyncHandlers = HttpApiBuilder.group(
  StoreApi,
  "sync",
  Effect.fn("SyncHandlers.make")(function* (handlers) {
    const authority = yield* SyncAuthority;
    const fanout = yield* LiveFanout;

    return handlers
      .handle("registerReplica", ({ payload }) =>
        asActor("registerReplica", (actor) => authority.registerReplica(actor, payload)),
      )
      .handleRaw("submitCommand", ({ request }) =>
        asActor("submitCommand", (actor) =>
          Effect.gen(function* () {
            const bodyText = yield* boundedBodyText(request, MAX_SUBMIT_BODY_BYTES);
            if (bodyText === undefined) return commandTooLargeResponse();
            const submitted = yield* authority.submitCommand(actor, bodyText);
            if (submitted.fanout !== null) {
              yield* fanout.publish(actor.organizationId, submitted.fanout);
            }
            return encodedJsonResponse(submitted.body);
          }).pipe(
            Effect.catchTag("SyncRequestMalformed", () => Effect.succeed(malformedCommandResponse)),
          ),
        ),
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
      .handle("pull", ({ payload }) =>
        asActor("pull", (actor) => authority.pull(actor, payload)).pipe(
          Effect.map((body) => encodedJsonResponse(body.json)),
        ),
      )
      .handle("acquireSnapshot", ({ payload }) =>
        asActor("acquireSnapshot", (actor) => authority.acquireSnapshot(actor, payload)),
      )
      .handle("readSnapshotPart", ({ params, request }) =>
        asActor("readSnapshotPart", (actor) =>
          authority.readSnapshotPart(actor, params.snapshotId, params.partNumber),
        ).pipe(Effect.map((part) => snapshotPartResponse(part, request.headers["if-none-match"]))),
      )
      .handleRaw("stageImportPart", ({ params, request }) =>
        asOwner("stageImportPart", (actor) =>
          Effect.gen(function* () {
            const bodyText = yield* boundedBodyText(request, MAX_IMPORT_PART_BYTES);
            if (bodyText === undefined) return importPartTooLargeResponse();
            const staged = yield* authority.stageImportPart(
              actor,
              params.importId,
              params.partNumber,
              bodyText,
            );
            return encodedJsonResponse(staged.json);
          }),
        ),
      )
      .handle("commitImport", ({ params, payload }) =>
        asOwner("commitImport", (actor) =>
          authority
            .commitImport(actor, params.importId, payload)
            .pipe(
              Effect.tap((committed) =>
                committed.fanout === null
                  ? Effect.void
                  : fanout.publish(actor.organizationId, committed.fanout),
              ),
            ),
        ).pipe(Effect.map((committed) => encodedJsonResponse(committed.json))),
      );
  }),
);
