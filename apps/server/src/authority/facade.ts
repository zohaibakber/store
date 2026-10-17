import {
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

import {
  AuthorityRequestMalformed,
  makeAuthorityEngine,
  type AuthorityActor,
  type EncodedCommit,
} from "./engine";
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

export type RegisterReply = {
  readonly replicaId: string;
  readonly nextClientSequence: string;
  readonly epoch: string;
  readonly incarnation: string;
  readonly retentionFloor: string;
  readonly horizon: string;
  readonly schemaVersion: number;
  readonly lowestActiveSchemaVersion: number;
};

export type DevicesReply = {
  readonly devices: ReadonlyArray<{
    readonly replicaId: string;
    readonly userId: string;
    readonly label: string | null;
    readonly registeredAt: number;
    readonly lastSeenAt: number;
    readonly upToDate: boolean;
    readonly ignored: boolean;
    readonly holdsBack: boolean;
  }>;
};

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
    actor: AuthorityActor,
    request: RegisterReplicaRequest,
  ) => Effect.Effect<AuthorityReply<RegisterReply>, E, R>;
  readonly submit: (
    actor: AuthorityActor,
    bodyText: string,
  ) => Effect.Effect<AuthorityReply<EncodedCommit>, E, R>;
  readonly receipt: (
    actor: AuthorityActor,
    operationId: string,
  ) => Effect.Effect<AuthorityReply<string | null>, E, R>;
  readonly pull: (
    actor: AuthorityActor,
    request: SyncPullRequest,
  ) => Effect.Effect<AuthorityReply<string>, E, R>;
  readonly acquireSnapshot: (
    actor: AuthorityActor,
    request: AcquireSnapshotRequest,
  ) => Effect.Effect<AuthorityReply<SnapshotReply>, E, R>;
  readonly readSnapshotPart: (
    actor: AuthorityActor,
    snapshotId: string,
    partNumber: number,
  ) => Effect.Effect<AuthorityReply<SnapshotPartReply>, E, R>;
  readonly devices: (actor: AuthorityActor) => Effect.Effect<AuthorityReply<DevicesReply>, E, R>;
  readonly deviceCommand: (
    actor: AuthorityActor,
    command: DeviceCommand,
  ) => Effect.Effect<AuthorityReply<DevicesReply>, E, R>;
  readonly liveHorizon: (
    actor: AuthorityActor,
    replicaId: string,
  ) => Effect.Effect<AuthorityReply<LiveHorizonReply>, E, R>;
  readonly stageImportPart: (
    actor: AuthorityActor,
    importId: string,
    partNumber: number,
    bodyText: string,
  ) => Effect.Effect<AuthorityReply<string>, E, R>;
  readonly commitImport: (
    actor: AuthorityActor,
    importId: string,
    request: ImportCatalogRequest,
  ) => Effect.Effect<AuthorityReply<EncodedCommit>, E, R>;
  readonly importStatus: (
    actor: AuthorityActor,
    importId: string,
  ) => Effect.Effect<AuthorityReply<ImportStatusReply>, E, R>;
  readonly maintain: () => Effect.Effect<MaintenanceReport, E, R>;
}

export type MaintenanceAlarm = {
  readonly scheduleBy: (at: number) => Effect.Effect<void>;
  readonly scheduleAt: (at: number) => Effect.Effect<void>;
};

export type OrgAuthorityDependencies<R> = {
  readonly sql: SqlClient;
  readonly mintId: Effect.Effect<string>;
  readonly alarm: MaintenanceAlarm;
  readonly adopt: (actor: AuthorityActor) => Effect.Effect<void, never, R>;
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

export const makeOrgAuthority = Effect.fn("OrgAuthority.make")(function* <R>(
  dependencies: OrgAuthorityDependencies<R>,
): Effect.fn.Return<OrgAuthorityApi<R>> {
  const { sql, mintId, alarm, adopt } = dependencies;
  yield* migrateAuthority(sql).pipe(Effect.orDie);
  const db = yield* makeReplicaDb(sql);
  const engine = makeAuthorityEngine(sql, db);
  const snapshots = makeAuthoritySnapshots(engine, db, mintId);
  const imports = makeAuthorityImports(sql, engine, db, snapshots);
  const maintenance = makeAuthorityMaintenance(engine, db, snapshots);

  const soon = Effect.flatMap(Clock.currentTimeMillis, (now) =>
    alarm.scheduleBy(now + MAINTENANCE_INTERVAL_MILLIS),
  );

  const serve = <A, E, R>(actor: AuthorityActor, effect: Effect.Effect<A, E, R>) =>
    replyOf(Effect.andThen(adopt(actor), effect));

  const serveWrite = <A, E, R>(actor: AuthorityActor, effect: Effect.Effect<A, E, R>) =>
    serve(
      actor,
      Effect.tap(effect, () => soon),
    );

  return {
    register: (actor, request) =>
      serveWrite(
        actor,
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
        actor,
        Effect.gen(function* () {
          return yield* engine.submit(
            actor,
            bodyText,
            yield* Clock.currentTimeMillis,
            pullByteBudget,
          );
        }),
      ),
    receipt: (actor, operationId) => serve(actor, engine.receipt(actor, operationId)),
    pull: (actor, request) =>
      serve(
        actor,
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
        actor,
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
      serve(actor, snapshots.readPart(actor, snapshotId, partNumber)),
    devices: (actor) =>
      serve(
        actor,
        Effect.flatMap(Clock.currentTimeMillis, (now) => engine.devices(actor, now)),
      ),
    deviceCommand: (actor, command) =>
      serve(
        actor,
        Effect.flatMap(Clock.currentTimeMillis, (now) => engine.deviceCommand(actor, command, now)),
      ),
    liveHorizon: (actor, replicaId) =>
      serve(
        actor,
        Effect.flatMap(Clock.currentTimeMillis, (now) => engine.liveHorizon(actor, replicaId, now)),
      ),
    stageImportPart: (actor, importId, partNumber, bodyText) =>
      serveWrite(
        actor,
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
          imports.stagePart(importId, partNumber, bodyText, now, IMPORT_LIMITS),
        ),
      ),
    commitImport: (actor, importId, request) =>
      serveWrite(
        actor,
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
    importStatus: (actor, importId) => serve(actor, imports.status(importId)),
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
  } satisfies OrgAuthorityApi<R>;
});
