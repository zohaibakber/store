import {
  OrganizationDevices,
  RegisterReplicaResult,
  SYNC_SCHEMA_VERSION,
  SyncProtocolError,
  type AcquireSnapshotRequest,
  type DeviceCommand,
  type ImportCatalogRequest,
  type RegisterReplicaRequest,
  type SyncProtocolCode,
  type SyncPullRequest,
} from "@store/contracts";
import { makeReplicaDb } from "@store/sync/authority";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { SqlClient } from "effect/sql/SqlClient";

import { AuthorityRequestMalformed, makeAuthorityEngine, type Actor } from "./engine";
import type { EncodedCommit } from "./frames";
import { makeAuthorityImports } from "./imports";
import { makeAuthorityMaintenance, type MaintenanceReport } from "./maintenance";
import { migrateAuthority } from "./migrations";
import {
  IMPORT_LIMITS,
  MAINTENANCE_CONTINUE_MILLIS,
  MAINTENANCE_INTERVAL_MILLIS,
  MAINTENANCE_POLICY,
  PULL_MAX_GROUPS,
  pullByteBudget,
  SNAPSHOT_POLICY,
} from "./policy";
import { makeAuthoritySnapshots } from "./snapshots";

export type AuthorityReply<A> =
  | { readonly _tag: "ok"; readonly value: A }
  | { readonly _tag: "refused"; readonly code: SyncProtocolCode; readonly message: string }
  | { readonly _tag: "malformed"; readonly message: string };

export type ImportStatusReply =
  | { readonly _tag: "committed"; readonly json: string }
  | { readonly _tag: "other"; readonly message: string }
  | { readonly _tag: "none" };

export type SnapshotPartReply = { readonly json: string; readonly sha256: string };

export type LiveHorizonReply = { readonly epoch: string; readonly horizon: string };

export type RegisterReply = typeof RegisterReplicaResult.Encoded;

export type DevicesReply = typeof OrganizationDevices.Encoded;

export type SnapshotReply = {
  readonly _tag: "ready";
  readonly manifest: {
    readonly snapshotId: string;
    readonly epoch: string;
    readonly subscription: string;
    readonly schemaVersion: number;
    readonly horizon: string;
    readonly parts: ReadonlyArray<{
      readonly partNumber: number;
      readonly objectKey: string;
      readonly byteLength: number;
      readonly sha256: string;
    }>;
    readonly entityCounts: ReadonlyArray<{ readonly entity: string; readonly rowCount: number }>;
    readonly digestVersion: number;
  };
};

export interface OrgAuthorityApi<R = never, E = never> {
  readonly register: (
    actor: Actor,
    request: RegisterReplicaRequest,
  ) => Effect.Effect<AuthorityReply<RegisterReply>, E, R>;
  readonly submit: (
    actor: Actor,
    bodyText: string,
  ) => Effect.Effect<AuthorityReply<EncodedCommit>, E, R>;
  readonly receipt: (
    actor: Actor,
    operationId: string,
  ) => Effect.Effect<AuthorityReply<string | null>, E, R>;
  readonly pull: (
    actor: Actor,
    request: SyncPullRequest,
  ) => Effect.Effect<AuthorityReply<string>, E, R>;
  readonly acquireSnapshot: (
    actor: Actor,
    request: AcquireSnapshotRequest,
  ) => Effect.Effect<AuthorityReply<SnapshotReply>, E, R>;
  readonly readSnapshotPart: (
    actor: Actor,
    snapshotId: string,
    partNumber: number,
  ) => Effect.Effect<AuthorityReply<SnapshotPartReply>, E, R>;
  readonly devices: (actor: Actor) => Effect.Effect<AuthorityReply<DevicesReply>, E, R>;
  readonly deviceCommand: (
    actor: Actor,
    command: DeviceCommand,
  ) => Effect.Effect<AuthorityReply<DevicesReply>, E, R>;
  readonly liveHorizon: (
    actor: Actor,
    replicaId: string,
  ) => Effect.Effect<AuthorityReply<LiveHorizonReply>, E, R>;
  readonly stageImportPart: (
    actor: Actor,
    importId: string,
    partNumber: number,
    bodyText: string,
  ) => Effect.Effect<AuthorityReply<string>, E, R>;
  readonly commitImport: (
    actor: Actor,
    importId: string,
    request: ImportCatalogRequest,
  ) => Effect.Effect<AuthorityReply<EncodedCommit>, E, R>;
  readonly importStatus: (
    actor: Actor,
    importId: string,
  ) => Effect.Effect<AuthorityReply<ImportStatusReply>, E, R>;
  readonly maintain: () => Effect.Effect<MaintenanceReport, E, R>;
}

export type MaintenanceAlarm = {
  readonly scheduleBy: (at: number) => Effect.Effect<void>;
  readonly scheduleAt: (at: number) => Effect.Effect<void>;
};

export type OrgAuthorityDependencies = {
  readonly sql: SqlClient;
  readonly mintId: Effect.Effect<string>;
  readonly alarm: MaintenanceAlarm;
};

const isProtocolError = Schema.is(SyncProtocolError);

const isMalformed = Schema.is(AuthorityRequestMalformed);

const replyOf = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<AuthorityReply<A>, never, R> =>
  effect.pipe(
    Effect.map((value): AuthorityReply<A> => ({ _tag: "ok", value })),
    Effect.catchIf(isProtocolError, (error) =>
      Effect.succeed<AuthorityReply<A>>({
        _tag: "refused",
        code: error.code,
        message: error.message,
      }),
    ),
    Effect.catchIf(isMalformed, (error) =>
      Effect.succeed<AuthorityReply<A>>({ _tag: "malformed", message: error.message }),
    ),
    Effect.orDie,
  );

export const makeOrgAuthority = Effect.fn("OrgAuthority.make")(function* (
  dependencies: OrgAuthorityDependencies,
): Effect.fn.Return<OrgAuthorityApi> {
  const { sql, mintId, alarm } = dependencies;
  yield* migrateAuthority(sql).pipe(Effect.orDie);
  const db = yield* makeReplicaDb(sql);
  const engine = makeAuthorityEngine(sql, db);
  const snapshots = makeAuthoritySnapshots(engine, db, mintId);
  const imports = makeAuthorityImports(sql, engine, db, snapshots);
  const maintenance = makeAuthorityMaintenance(engine, db, snapshots);

  const soon = Effect.flatMap(Clock.currentTimeMillis, (now) =>
    alarm.scheduleBy(now + MAINTENANCE_INTERVAL_MILLIS),
  );

  const serveWrite = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    replyOf(Effect.tap(effect, () => soon));

  return {
    register: (actor, request) =>
      serveWrite(
        Effect.gen(function* () {
          return yield* engine.register(
            actor,
            request,
            yield* Clock.currentTimeMillis,
            yield* mintId,
          );
        }),
      ),
    submit: (actor, bodyText) =>
      serveWrite(
        Effect.gen(function* () {
          return yield* engine.submit(
            actor,
            bodyText,
            yield* Clock.currentTimeMillis,
            pullByteBudget,
          );
        }),
      ),
    receipt: (actor, operationId) => replyOf(engine.receipt(actor, operationId)),
    pull: (actor, request) =>
      replyOf(
        engine.pull(actor, {
          epoch: request.epoch,
          subscription: request.subscription,
          afterCommitSequence: request.afterCommitSequence,
          maxGroups: PULL_MAX_GROUPS,
          byteBudget: pullByteBudget(request.maxBytes),
          digestVersion: request.digestVersion,
        }),
      ),
    acquireSnapshot: (actor, request) =>
      serveWrite(
        Effect.gen(function* () {
          return yield* snapshots.acquire(
            actor,
            {
              epoch: request.epoch,
              subscription: request.subscription,
              replicaId: request.replicaId,
            },
            SYNC_SCHEMA_VERSION,
            yield* Clock.currentTimeMillis,
            SNAPSHOT_POLICY,
          );
        }),
      ),
    readSnapshotPart: (actor, snapshotId, partNumber) =>
      replyOf(snapshots.readPart(actor, snapshotId, partNumber)),
    devices: (actor) =>
      replyOf(Effect.flatMap(Clock.currentTimeMillis, (now) => engine.devices(actor, now))),
    deviceCommand: (actor, command) =>
      replyOf(
        Effect.flatMap(Clock.currentTimeMillis, (now) => engine.deviceCommand(actor, command, now)),
      ),
    liveHorizon: (actor, replicaId) =>
      replyOf(
        Effect.flatMap(Clock.currentTimeMillis, (now) => engine.liveHorizon(actor, replicaId, now)),
      ),
    stageImportPart: (_actor, importId, partNumber, bodyText) =>
      serveWrite(
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
          imports.stagePart(importId, partNumber, bodyText, now, IMPORT_LIMITS),
        ),
      ),
    commitImport: (actor, importId, request) =>
      serveWrite(
        Effect.gen(function* () {
          return yield* imports.commit(
            actor,
            importId,
            request,
            yield* Clock.currentTimeMillis,
            yield* mintId,
          );
        }),
      ),
    importStatus: (_actor, importId) => replyOf(imports.status(importId)),
    maintain: () =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const report = yield* maintenance.run(now, MAINTENANCE_POLICY);
        const state = yield* engine.loadState;
        const retained =
          state !== undefined &&
          state.commitSequence - state.retentionFloor >
            MAINTENANCE_POLICY.minimumRetainedTransactions;
        if (report.more) {
          yield* alarm.scheduleAt(now + MAINTENANCE_CONTINUE_MILLIS);
        } else if (retained || (yield* maintenance.pendingWork())) {
          yield* alarm.scheduleAt(now + MAINTENANCE_INTERVAL_MILLIS);
        }
        return report;
      }).pipe(Effect.orDie),
  } satisfies OrgAuthorityApi;
});
