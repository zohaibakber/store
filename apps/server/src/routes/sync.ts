import { MAX_IMPORT_PART_BYTES } from "@store/contracts";
import { SyncForbidden, SyncNotFound } from "@store/contracts/sync/api";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { CurrentOrganization } from "../auth/organization";
import type { Actor } from "../authority/engine";
import type { SnapshotPartReply } from "../authority/facade";
import { StoreApi } from "../http/api";
import { publicError } from "../http/errors";
import { failWithSyncHttpError } from "../http/sync-errors";
import type { InventoryError } from "../inventory/errors";
import { MAX_SUBMIT_BODY_BYTES, OrganizationAuthority } from "../inventory/organization-authority";
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

const snapshotPartResponse = (part: SnapshotPartReply, ifNoneMatch: string | undefined) => {
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

const asActor = <A, R>(span: string, run: (actor: Actor) => Effect.Effect<A, InventoryError, R>) =>
  CurrentOrganization.pipe(
    Effect.flatMap(run),
    Effect.catch(failWithSyncHttpError),
    Effect.withSpan(`SyncHandlers.${span}`),
  );

const ownerRequired = (message: string) =>
  SyncForbidden.make(publicError("OWNER_REQUIRED", message));

const publishOwnerRequired = ownerRequired(
  "Only an owner can move a device's data into this organization.",
);

const devicesOwnerRequired = ownerRequired("Only an owner can manage this organization's devices.");

const asOwner = <A, R>(
  span: string,
  refusal: SyncForbidden,
  run: (actor: Actor) => Effect.Effect<A, InventoryError, R>,
) =>
  CurrentOrganization.pipe(
    Effect.flatMap((identity) =>
      identity.role === "owner"
        ? Effect.catch(run(identity), failWithSyncHttpError)
        : Effect.fail(refusal),
    ),
    Effect.withSpan(`SyncHandlers.${span}`),
  );

export const SyncHandlers = HttpApiBuilder.group(
  StoreApi,
  "sync",
  Effect.fn("SyncHandlers.make")(function* (handlers) {
    const authority = yield* OrganizationAuthority;
    const fanout = yield* LiveFanout;

    return handlers
      .handle("registerReplica", ({ payload }) =>
        asActor("registerReplica", (actor) => authority.register(actor, payload)),
      )
      .handleRaw("submitCommand", ({ request }) =>
        asActor("submitCommand", (actor) =>
          Effect.gen(function* () {
            const bodyText = yield* boundedBodyText(request, MAX_SUBMIT_BODY_BYTES);
            if (bodyText === undefined) return commandTooLargeResponse();
            const submitted = yield* authority.submit(actor, bodyText);
            if (submitted.fanout !== null) {
              yield* fanout.publish(actor.organizationId, submitted.fanout);
            }
            return encodedJsonResponse(submitted.json);
          }).pipe(
            Effect.catchTag("SyncRequestMalformed", () => Effect.succeed(malformedCommandResponse)),
          ),
        ),
      )
      .handle("getReceipt", ({ params }) =>
        asActor("getReceipt", (actor) => authority.receipt(actor, params.operationId)).pipe(
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
        asOwner("stageImportPart", publishOwnerRequired, (actor) =>
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
        asOwner("commitImport", publishOwnerRequired, (actor) =>
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
      )
      .handle("readImportStatus", ({ params }) =>
        asOwner("readImportStatus", publishOwnerRequired, (actor) =>
          authority.importStatus(actor, params.importId),
        ),
      )
      .handle("listDevices", () =>
        asOwner("listDevices", devicesOwnerRequired, (actor) => authority.devices(actor)),
      )
      .handle("commandDevice", ({ payload }) =>
        asOwner("commandDevice", devicesOwnerRequired, (actor) =>
          authority.commandDevice(actor, payload),
        ),
      );
  }),
);
