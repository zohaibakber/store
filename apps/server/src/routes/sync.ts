import { MAX_IMPORT_PART_BYTES } from "@store/contracts";
import { SyncForbidden, SyncNotFound } from "@store/contracts/sync/api";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Result from "effect/Result";

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

const unreadableBodyResponse = () =>
  HttpServerResponse.jsonUnsafe(
    publicError("INVALID_BODY", "The request body could not be read."),
    { status: 400 },
  );

const boundedBodyText = (
  request: HttpServerRequest.HttpServerRequest,
  maxBytes: number,
  tooLarge: () => HttpServerResponse.HttpServerResponse,
): Effect.Effect<Result.Result<string, HttpServerResponse.HttpServerResponse>> =>
  declaresOversizedBody(request, maxBytes)
    ? Effect.succeed(Result.fail(tooLarge()))
    : request.arrayBuffer.pipe(
        Effect.map((buffer) =>
          buffer.byteLength > maxBytes
            ? Result.fail(tooLarge())
            : Result.succeed(utf8.decode(buffer)),
        ),
        Effect.catchTag("HttpServerError", () =>
          Effect.succeed(Result.fail(unreadableBodyResponse())),
        ),
      );

const asActor = <A, E extends InventoryError, R>(run: (actor: Actor) => Effect.Effect<A, E, R>) =>
  CurrentOrganization.pipe(Effect.flatMap(run), Effect.catch(failWithSyncHttpError));

const ownerRefusal = (message: string) =>
  SyncForbidden.make(publicError("OWNER_REQUIRED", message));

const publishOwnerRequired = ownerRefusal(
  "Only an owner can move a device's data into this organization.",
);

const devicesOwnerRequired = ownerRefusal("Only an owner can manage this organization's devices.");

const asOwner = <A, R>(
  refusal: SyncForbidden,
  run: (actor: Actor) => Effect.Effect<A, InventoryError, R>,
) =>
  CurrentOrganization.pipe(
    Effect.flatMap((identity) =>
      identity.role === "owner"
        ? Effect.catch(run(identity), failWithSyncHttpError)
        : Effect.fail(refusal),
    ),
  );

export const SyncHandlers = HttpApiBuilder.group(
  StoreApi,
  "sync",
  Effect.fn("SyncHandlers.make")(function* (handlers) {
    const authority = yield* OrganizationAuthority;
    const fanout = yield* LiveFanout;

    return handlers
      .handle(
        "registerReplica",
        Effect.fn("SyncHandlers.registerReplica")(function* ({ payload }) {
          return yield* asActor((actor) => authority.register(actor, payload));
        }),
      )
      .handleRaw(
        "submitCommand",
        Effect.fn("SyncHandlers.submitCommand")(function* ({ request }) {
          return yield* asActor((actor) =>
            Effect.gen(function* () {
              const bodyText = yield* boundedBodyText(
                request,
                MAX_SUBMIT_BODY_BYTES,
                commandTooLargeResponse,
              );
              if (Result.isFailure(bodyText)) return bodyText.failure;
              const submitted = yield* authority.submit(actor, bodyText.success);
              if (submitted.fanout !== null) {
                yield* fanout.publish(actor.organizationId, submitted.fanout);
              }
              return encodedJsonResponse(submitted.json);
            }).pipe(
              Effect.catchTag("SyncRequestMalformed", () =>
                Effect.succeed(malformedCommandResponse),
              ),
            ),
          );
        }),
      )
      .handle(
        "getReceipt",
        Effect.fn("SyncHandlers.getReceipt")(function* ({ params }) {
          const receipt = yield* asActor((actor) => authority.receipt(actor, params.operationId));
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
          const body = yield* asActor((actor) => authority.pull(actor, payload));
          return encodedJsonResponse(body.json);
        }),
      )
      .handle(
        "acquireSnapshot",
        Effect.fn("SyncHandlers.acquireSnapshot")(function* ({ payload }) {
          return yield* asActor((actor) => authority.acquireSnapshot(actor, payload));
        }),
      )
      .handle(
        "readSnapshotPart",
        Effect.fn("SyncHandlers.readSnapshotPart")(function* ({ params, request }) {
          const part = yield* asActor((actor) =>
            authority.readSnapshotPart(actor, params.snapshotId, params.partNumber),
          );
          return snapshotPartResponse(part, request.headers["if-none-match"]);
        }),
      )
      .handleRaw(
        "stageImportPart",
        Effect.fn("SyncHandlers.stageImportPart")(function* ({ params, request }) {
          return yield* asOwner(publishOwnerRequired, (actor) =>
            Effect.gen(function* () {
              const bodyText = yield* boundedBodyText(
                request,
                MAX_IMPORT_PART_BYTES,
                importPartTooLargeResponse,
              );
              if (Result.isFailure(bodyText)) return bodyText.failure;
              const staged = yield* authority.stageImportPart(
                actor,
                params.importId,
                params.partNumber,
                bodyText.success,
              );
              return encodedJsonResponse(staged.json);
            }),
          );
        }),
      )
      .handle(
        "commitImport",
        Effect.fn("SyncHandlers.commitImport")(function* ({ params, payload }) {
          const committed = yield* asOwner(publishOwnerRequired, (actor) =>
            authority
              .commitImport(actor, params.importId, payload)
              .pipe(
                Effect.tap((result) =>
                  result.fanout === null
                    ? Effect.void
                    : fanout.publish(actor.organizationId, result.fanout),
                ),
              ),
          );
          return encodedJsonResponse(committed.json);
        }),
      )
      .handle(
        "readImportStatus",
        Effect.fn("SyncHandlers.readImportStatus")(function* ({ params }) {
          return yield* asOwner(publishOwnerRequired, (actor) =>
            authority.importStatus(actor, params.importId),
          );
        }),
      )
      .handle(
        "listDevices",
        Effect.fn("SyncHandlers.listDevices")(function* () {
          return yield* asOwner(devicesOwnerRequired, (actor) => authority.devices(actor));
        }),
      )
      .handle(
        "commandDevice",
        Effect.fn("SyncHandlers.commandDevice")(function* ({ payload }) {
          return yield* asOwner(devicesOwnerRequired, (actor) =>
            authority.commandDevice(actor, payload),
          );
        }),
      );
  }),
);
