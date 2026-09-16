import {
  AcquireSnapshotRequest,
  AcquireSnapshotResult,
  CommandReceipt,
  LiveTicket,
  LiveTicketNonce,
  LiveTicketRequest,
  OrganizationId,
  RegisterReplicaRequest,
  RegisterReplicaResult,
  SnapshotId,
  SnapshotPartPayload,
  SyncCommandEnvelope,
  SyncProtocolError,
  SyncPullRequest,
  SyncPullResult,
  syncProtocolError,
} from "@store/contracts";
import { RpcCallError } from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import {
  InventoryDirectoryUnavailable,
  InventoryNotPublished,
  type InventoryDirectoryContract,
} from "./inventory-directory";
import {
  ReceiptLookup,
  RpcReply,
  SnapshotPartLookup,
  type InventorySyncActor,
  type OrganizationInventoryNamespace,
  type SnapshotObjectsContract,
} from "./organization-host";

export class SyncUnavailableError extends Schema.TaggedError<SyncUnavailableError>()(
  "SyncUnavailableError",
  { message: Schema.String },
) {}

export const syncUnavailableError = (message = "Organization sync is not provisioned.") =>
  SyncUnavailableError.make({ message });

export type SyncAuthorityError = SyncProtocolError | SyncUnavailableError;

export interface SyncAuthorityContract {
  readonly registerReplica: (
    actor: InventorySyncActor,
    request: RegisterReplicaRequest,
  ) => Effect.Effect<RegisterReplicaResult, SyncAuthorityError>;
  readonly submitCommand: (
    actor: InventorySyncActor,
    envelope: SyncCommandEnvelope,
  ) => Effect.Effect<CommandReceipt, SyncAuthorityError>;
  readonly getReceipt: (
    actor: InventorySyncActor,
    operationId: string,
  ) => Effect.Effect<CommandReceipt | undefined, SyncAuthorityError>;
  readonly pull: (
    actor: InventorySyncActor,
    request: SyncPullRequest,
  ) => Effect.Effect<SyncPullResult, SyncAuthorityError>;
  readonly acquireSnapshot: (
    actor: InventorySyncActor,
    request: AcquireSnapshotRequest,
  ) => Effect.Effect<AcquireSnapshotResult, SyncAuthorityError>;
  readonly readSnapshotPart: (
    actor: InventorySyncActor,
    snapshotId: SnapshotId,
    partNumber: number,
  ) => Effect.Effect<SnapshotPartPayload, SyncAuthorityError>;
  readonly mintLiveTicket: (
    actor: InventorySyncActor,
    request: LiveTicketRequest,
  ) => Effect.Effect<LiveTicket, SyncAuthorityError>;
}

export class SyncAuthority extends Context.Service<SyncAuthority, SyncAuthorityContract>()(
  "@store/server/SyncAuthority",
) {}

const unavailable = () => Effect.fail(syncUnavailableError());

export const unprovisionedSyncAuthority: SyncAuthorityContract = {
  registerReplica: () => unavailable(),
  submitCommand: () => unavailable(),
  getReceipt: () => unavailable(),
  pull: () => unavailable(),
  acquireSnapshot: () => unavailable(),
  readSnapshotPart: () => unavailable(),
  mintLiveTicket: () => unavailable(),
};

export const UnprovisionedSyncAuthorityLive = Layer.succeed(
  SyncAuthority,
  unprovisionedSyncAuthority,
);

const notPublished = () =>
  syncProtocolError("EPOCH_MISMATCH", "This organization has no published inventory.");

const directoryUnavailable = () => syncUnavailableError("Inventory directory is unavailable.");

const transportUnavailable = () =>
  syncUnavailableError("Organization inventory is unavailable.");

const unreadableReply = () =>
  syncUnavailableError("Organization inventory reply was unreadable.");

const mapDirectoryError = (
  error: InventoryNotPublished | InventoryDirectoryUnavailable,
): SyncAuthorityError => {
  if (error._tag === "InventoryNotPublished") return notPublished();
  return directoryUnavailable();
};

const actorOrganizationId = (actor: InventorySyncActor) =>
  Schema.decodeUnknownEffect(OrganizationId)(actor.organizationId).pipe(
    Effect.mapError(() =>
      syncProtocolError(
        "ORGANIZATION_MISMATCH",
        "The actor does not belong to the active organization.",
      ),
    ),
  );

const deliverReply = <Value>(reply: {
  readonly _tag: "success";
  readonly value: Value;
} | {
  readonly _tag: "protocolFailure";
  readonly code: SyncProtocolError["code"];
  readonly message: string;
}): Effect.Effect<Value, SyncProtocolError> => {
  if (reply._tag === "protocolFailure") {
    return Effect.fail(syncProtocolError(reply.code, reply.message));
  }
  return Effect.succeed(reply.value);
};

const invokeRpc = <A>(
  effect: Effect.Effect<A, RpcCallError>,
): Effect.Effect<A, SyncUnavailableError> =>
  effect.pipe(Effect.catchTag("RpcCallError", () => Effect.fail(transportUnavailable())));

const decodeRpc = <S extends Schema.Top>(schema: S, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(Effect.mapError(() => unreadableReply()));

export const makeRoutedSyncAuthority = (
  directory: InventoryDirectoryContract,
  objects: OrganizationInventoryNamespace,
  snapshots: SnapshotObjectsContract,
): SyncAuthorityContract => {
  const routeFor = (actor: InventorySyncActor) =>
    actorOrganizationId(actor).pipe(
      Effect.flatMap((organizationId) =>
        directory.resolveActive(organizationId).pipe(Effect.mapError(mapDirectoryError)),
      ),
    );

  const stubFor = (objectName: string) => objects.getByName(objectName);

  return {
    registerReplica: Effect.fn("SyncAuthority.registerReplica")(function* (actor, request) {
      const route = yield* routeFor(actor);
      const raw = yield* invokeRpc(
        stubFor(route.objectName).registerReplica({
          route: route.evidence,
          actor,
          input: request,
        }),
      );
      const reply = yield* decodeRpc(RpcReply(RegisterReplicaResult), raw);
      return yield* deliverReply(reply);
    }),
    submitCommand: Effect.fn("SyncAuthority.submitCommand")(function* (actor, envelope) {
      const route = yield* routeFor(actor);
      const raw = yield* invokeRpc(
        stubFor(route.objectName).submitCommand({
          route: route.evidence,
          actor,
          input: envelope,
        }),
      );
      const reply = yield* decodeRpc(RpcReply(CommandReceipt), raw);
      return yield* deliverReply(reply);
    }),
    getReceipt: Effect.fn("SyncAuthority.getReceipt")(function* (actor, operationId) {
      const route = yield* routeFor(actor);
      const raw = yield* invokeRpc(
        stubFor(route.objectName).getReceipt({
          route: route.evidence,
          actor,
          input: { operationId },
        }),
      );
      const reply = yield* decodeRpc(RpcReply(ReceiptLookup), raw);
      const lookup = yield* deliverReply(reply);
      return lookup._tag === "found" ? lookup.receipt : undefined;
    }),
    pull: Effect.fn("SyncAuthority.pull")(function* (actor, request) {
      const route = yield* routeFor(actor);
      const raw = yield* invokeRpc(
        stubFor(route.objectName).pull({
          route: route.evidence,
          actor,
          input: request,
        }),
      );
      const reply = yield* decodeRpc(RpcReply(SyncPullResult), raw);
      return yield* deliverReply(reply);
    }),
    acquireSnapshot: Effect.fn("SyncAuthority.acquireSnapshot")(function* (actor, request) {
      const route = yield* routeFor(actor);
      const raw = yield* invokeRpc(
        stubFor(route.objectName).acquireSnapshot({
          route: route.evidence,
          actor,
          input: request,
        }),
      );
      const reply = yield* decodeRpc(RpcReply(AcquireSnapshotResult), raw);
      return yield* deliverReply(reply);
    }),
    readSnapshotPart: Effect.fn("SyncAuthority.readSnapshotPart")(function* (
      actor,
      snapshotId,
      partNumber,
    ) {
      const route = yield* routeFor(actor);
      const raw = yield* invokeRpc(
        stubFor(route.objectName).locateSnapshotPart({
          route: route.evidence,
          actor,
          input: { snapshotId, partNumber },
        }),
      );
      const reply = yield* decodeRpc(RpcReply(SnapshotPartLookup), raw);
      const lookup = yield* deliverReply(reply);
      if (lookup._tag === "missing") {
        return yield* Effect.fail(
          syncProtocolError("SNAPSHOT_UNAVAILABLE", "That snapshot part is not available."),
        );
      }
      const bytes = yield* snapshots.getObject(lookup.locator.objectKey).pipe(
        Effect.mapError(() =>
          syncUnavailableError("Inventory snapshot storage is unavailable."),
        ),
      );
      if (bytes === undefined) {
        return yield* Effect.fail(
          syncProtocolError("SNAPSHOT_UNAVAILABLE", "That snapshot part is not available."),
        );
      }
      const parsed = yield* Effect.try({
        try: () => JSON.parse(new TextDecoder().decode(bytes)),
        catch: () =>
          syncProtocolError("SNAPSHOT_UNAVAILABLE", "That snapshot part is not available."),
      });
      return yield* Schema.decodeUnknownEffect(SnapshotPartPayload)(parsed).pipe(
        Effect.mapError(() =>
          syncProtocolError("SNAPSHOT_UNAVAILABLE", "That snapshot part is not available."),
        ),
      );
    }),
    mintLiveTicket: Effect.fn("SyncAuthority.mintLiveTicket")(function* (actor, request) {
      const route = yield* routeFor(actor);
      const raw = yield* invokeRpc(
        stubFor(route.objectName).mintLiveTicket({
          route: route.evidence,
          actor,
          input: request,
        }),
      );
      const reply = yield* decodeRpc(RpcReply(LiveTicket), raw);
      return yield* deliverReply(reply);
    }),
  };
};

export interface SyncLiveUpgradeContract {
  readonly handle: (
    actor: InventorySyncActor,
  ) => Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    SyncAuthorityError,
    HttpServerRequest.HttpServerRequest
  >;
}

export class SyncLiveUpgrade extends Context.Service<SyncLiveUpgrade, SyncLiveUpgradeContract>()(
  "@store/server/SyncLiveUpgrade",
) {}

export const unprovisionedSyncLiveUpgrade: SyncLiveUpgradeContract = {
  handle: () =>
    Effect.succeed(
      HttpServerResponse.jsonUnsafe(
        { error: { code: "SYNC_NOT_PROVISIONED", message: "Organization sync is not provisioned." } },
        { status: 503 },
      ),
    ),
};

export const UnprovisionedSyncLiveUpgradeLive = Layer.succeed(
  SyncLiveUpgrade,
  unprovisionedSyncLiveUpgrade,
);

export const makeRoutedLiveUpgrade = (
  directory: InventoryDirectoryContract,
  objects: OrganizationInventoryNamespace,
): SyncLiveUpgradeContract => ({
  handle: Effect.fn("SyncLiveUpgrade.handle")(function* (actor) {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = Option.getOrUndefined(HttpServerRequest.toURL(request));
    const nonce = url?.searchParams.get("nonce") ?? undefined;
    const parsedNonce = yield* Schema.decodeUnknownEffect(LiveTicketNonce)(nonce).pipe(
      Effect.mapError(() => syncProtocolError("TICKET_INVALID", "The live ticket nonce is invalid.")),
    );
    const organizationId = yield* actorOrganizationId(actor);
    const route = yield* directory
      .resolveActive(organizationId)
      .pipe(Effect.mapError(mapDirectoryError));
    const forwarded = request.modify({
      url: `/api/sync/live?nonce=${parsedNonce}`,
      headers: Headers.fromInput({
        upgrade: request.headers.upgrade,
        connection: request.headers.connection,
      }),
    });
    return yield* invokeRpc(objects.getByName(route.objectName).fetch(forwarded));
  }),
});
