import {
  AcquireSnapshotResult,
  CommandReceipt,
  ImportCatalogResult,
  OrganizationDevices,
  OrgCommitSequence,
  RegisterReplicaResult,
  SyncEpoch,
  syncProtocolError,
  type AcquireSnapshotRequest,
  type DeviceCommand,
  type ImportCatalogRequest,
  type ImportId,
  type ImportStatus,
  type RegisterReplicaRequest,
  type SnapshotId,
  type SyncPullRequest,
} from "@store/contracts";
import type { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { Actor } from "../authority/engine";
import type { AuthorityReply, OrgAuthorityApi, SnapshotPartReply } from "../authority/facade";
import type { EncodedCommit } from "../authority/frames";
import { InventoryDatabaseError, SyncRequestMalformed, type InventoryError } from "./errors";

export const MAX_SUBMIT_BODY_BYTES = 2 * 1024 * 1024;

interface EncodedJsonBody {
  readonly json: string;
}

interface LiveHorizon {
  readonly epoch: SyncEpoch;
  readonly horizon: OrgCommitSequence;
}

const decodeRegisterResult = Schema.decodeUnknownEffect(RegisterReplicaResult);
const decodeReceipt = Schema.decodeUnknownEffect(Schema.fromJsonString(CommandReceipt));
const decodeAcquired = Schema.decodeUnknownEffect(AcquireSnapshotResult);
const decodeImportResult = Schema.decodeUnknownEffect(Schema.fromJsonString(ImportCatalogResult));
const decodeDevices = Schema.decodeUnknownEffect(OrganizationDevices);

const garbled = (cause: Schema.SchemaError) =>
  new InventoryDatabaseError({
    message: "The organization authority answered with a reply that could not be read.",
    cause,
  });

const unreachable = (cause: unknown) =>
  new InventoryDatabaseError({
    message: "The organization authority did not answer.",
    cause,
  });

const settle = Effect.fnUntraced(function* <A>(reply: AuthorityReply<A>) {
  switch (reply._tag) {
    case "ok":
      return reply.value;
    case "refused":
      return yield* syncProtocolError(reply.code, reply.message);
    case "malformed":
      return yield* new SyncRequestMalformed({ message: reply.message });
  }
});

const answeredOrMalformed = <A, E, R>(reply: Effect.Effect<AuthorityReply<A>, E, R>) =>
  reply.pipe(Effect.mapError(unreachable), Effect.flatMap(settle));

const answered = <A, E, R>(reply: Effect.Effect<AuthorityReply<A>, E, R>) =>
  answeredOrMalformed(reply).pipe(
    Effect.catchTag("SyncRequestMalformed", (malformed) =>
      Effect.fail(new InventoryDatabaseError({ message: malformed.message })),
    ),
  );

export class OrgAuthorities extends Context.Service<
  OrgAuthorities,
  {
    readonly getByName: (organizationId: string) => OrgAuthorityApi<RuntimeContext, unknown>;
  }
>()("@store/server/OrgAuthorities") {}

export class OrganizationAuthority extends Context.Service<
  OrganizationAuthority,
  {
    readonly register: (
      actor: Actor,
      request: RegisterReplicaRequest,
    ) => Effect.Effect<RegisterReplicaResult, InventoryError, RuntimeContext>;
    readonly submit: (
      actor: Actor,
      bodyText: string,
    ) => Effect.Effect<EncodedCommit, InventoryError | SyncRequestMalformed, RuntimeContext>;
    readonly receipt: (
      actor: Actor,
      operationId: string,
    ) => Effect.Effect<CommandReceipt | undefined, InventoryError, RuntimeContext>;
    readonly pull: (
      actor: Actor,
      request: SyncPullRequest,
    ) => Effect.Effect<EncodedJsonBody, InventoryError, RuntimeContext>;
    readonly acquireSnapshot: (
      actor: Actor,
      request: AcquireSnapshotRequest,
    ) => Effect.Effect<AcquireSnapshotResult, InventoryError, RuntimeContext>;
    readonly readSnapshotPart: (
      actor: Actor,
      snapshotId: SnapshotId,
      partNumber: number,
    ) => Effect.Effect<SnapshotPartReply, InventoryError, RuntimeContext>;
    readonly stageImportPart: (
      actor: Actor,
      importId: ImportId,
      partNumber: number,
      bodyText: string,
    ) => Effect.Effect<EncodedJsonBody, InventoryError, RuntimeContext>;
    readonly commitImport: (
      actor: Actor,
      importId: ImportId,
      request: ImportCatalogRequest,
    ) => Effect.Effect<EncodedCommit, InventoryError, RuntimeContext>;
    readonly importStatus: (
      actor: Actor,
      importId: ImportId,
    ) => Effect.Effect<ImportStatus, InventoryError, RuntimeContext>;
    readonly devices: (
      actor: Actor,
    ) => Effect.Effect<OrganizationDevices, InventoryError, RuntimeContext>;
    readonly commandDevice: (
      actor: Actor,
      command: DeviceCommand,
    ) => Effect.Effect<OrganizationDevices, InventoryError, RuntimeContext>;
    readonly liveHorizon: (
      actor: Actor,
      replicaId: string,
    ) => Effect.Effect<LiveHorizon, InventoryError, RuntimeContext>;
  }
>()("@store/server/OrganizationAuthority") {
  static readonly layer = Layer.effect(
    OrganizationAuthority,
    Effect.gen(function* () {
      const authorities = yield* OrgAuthorities;
      const authorityOf = (actor: Actor) => authorities.getByName(actor.organizationId);

      const register = Effect.fn("OrganizationAuthority.register")(function* (
        actor: Actor,
        request: RegisterReplicaRequest,
      ) {
        const result = yield* answered(authorityOf(actor).register(actor, request));
        return yield* decodeRegisterResult(result).pipe(Effect.mapError(garbled));
      });

      const submit = Effect.fn("OrganizationAuthority.submit")(function* (
        actor: Actor,
        bodyText: string,
      ) {
        return yield* answeredOrMalformed(authorityOf(actor).submit(actor, bodyText));
      });

      const receipt = Effect.fn("OrganizationAuthority.receipt")(function* (
        actor: Actor,
        operationId: string,
      ) {
        const json = yield* answered(authorityOf(actor).receipt(actor, operationId));
        return json === null
          ? undefined
          : yield* decodeReceipt(json).pipe(Effect.mapError(garbled));
      });

      const pull = Effect.fn("OrganizationAuthority.pull")(function* (
        actor: Actor,
        request: SyncPullRequest,
      ) {
        const json = yield* answered(authorityOf(actor).pull(actor, request));
        return { json } satisfies EncodedJsonBody;
      });

      const acquireSnapshot = Effect.fn("OrganizationAuthority.acquireSnapshot")(function* (
        actor: Actor,
        request: AcquireSnapshotRequest,
      ) {
        const acquired = yield* answered(authorityOf(actor).acquireSnapshot(actor, request));
        return yield* decodeAcquired(acquired).pipe(Effect.mapError(garbled));
      });

      const readSnapshotPart = Effect.fn("OrganizationAuthority.readSnapshotPart")(function* (
        actor: Actor,
        snapshotId: SnapshotId,
        partNumber: number,
      ) {
        return yield* answered(authorityOf(actor).readSnapshotPart(actor, snapshotId, partNumber));
      });

      const stageImportPart = Effect.fn("OrganizationAuthority.stageImportPart")(function* (
        actor: Actor,
        importId: ImportId,
        partNumber: number,
        bodyText: string,
      ) {
        const json = yield* answered(
          authorityOf(actor).stageImportPart(actor, importId, partNumber, bodyText),
        );
        return { json } satisfies EncodedJsonBody;
      });

      const commitImport = Effect.fn("OrganizationAuthority.commitImport")(function* (
        actor: Actor,
        importId: ImportId,
        request: ImportCatalogRequest,
      ) {
        return yield* answered(authorityOf(actor).commitImport(actor, importId, request));
      });

      const importStatus = Effect.fn("OrganizationAuthority.importStatus")(function* (
        actor: Actor,
        importId: ImportId,
      ) {
        const status = yield* answered(authorityOf(actor).importStatus(actor, importId));
        switch (status._tag) {
          case "committed": {
            const result = yield* decodeImportResult(status.json).pipe(Effect.mapError(garbled));
            return { _tag: "committed", result } satisfies ImportStatus;
          }
          case "other":
            return { _tag: "other", message: status.message } satisfies ImportStatus;
          case "none":
            return { _tag: "none" } satisfies ImportStatus;
        }
      });

      const devices = Effect.fn("OrganizationAuthority.devices")(function* (actor: Actor) {
        const listed = yield* answered(authorityOf(actor).devices(actor));
        return yield* decodeDevices(listed).pipe(Effect.mapError(garbled));
      });

      const commandDevice = Effect.fn("OrganizationAuthority.commandDevice")(function* (
        actor: Actor,
        command: DeviceCommand,
      ) {
        const listed = yield* answered(authorityOf(actor).deviceCommand(actor, command));
        return yield* decodeDevices(listed).pipe(Effect.mapError(garbled));
      });

      const liveHorizon = Effect.fn("OrganizationAuthority.liveHorizon")(function* (
        actor: Actor,
        replicaId: string,
      ) {
        const horizon = yield* answered(authorityOf(actor).liveHorizon(actor, replicaId));
        return {
          epoch: SyncEpoch.make(horizon.epoch),
          horizon: OrgCommitSequence.make(horizon.horizon),
        } satisfies LiveHorizon;
      });

      return OrganizationAuthority.of({
        register,
        submit,
        receipt,
        pull,
        acquireSnapshot,
        readSnapshotPart,
        stageImportPart,
        commitImport,
        importStatus,
        devices,
        commandDevice,
        liveHorizon,
      });
    }),
  );
}
