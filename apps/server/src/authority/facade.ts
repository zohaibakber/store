import {
  AcquireSnapshotResult,
  RegisterReplicaResult,
  SYNC_SCHEMA_VERSION,
  SyncProtocolError,
  type AcquireSnapshotRequest,
  type ImportCatalogRequest,
  type RegisterReplicaRequest,
  type SyncProtocolCode,
  type SyncPullRequest,
} from "@store/contracts";
import { makeReplicaDb } from "@store/sync/authority";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { AuthorityRequestMalformed, makeAuthorityEngine, type Actor } from "./engine";
import type { CommitFanout, EncodedCommit } from "./frames";
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

export type SnapshotReply = typeof AcquireSnapshotResult.Encoded;

export interface OrgAuthorityApi<R = never, E = never> {
  readonly register: (
    actor: Actor,
    request: RegisterReplicaRequest,
  ) => Effect.Effect<AuthorityReply<RegisterReply>, E, R>;
  readonly submit: (actor: Actor, bodyText: string) => Effect.Effect<AuthorityReply<string>, E, R>;
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
  ) => Effect.Effect<AuthorityReply<string>, E, R>;
  readonly importStatus: (
    actor: Actor,
    importId: string,
  ) => Effect.Effect<AuthorityReply<ImportStatusReply>, E, R>;
  readonly maintain: () => Effect.Effect<MaintenanceReport, E, R>;
}

export class MaintenanceAlarm extends Context.Service<
  MaintenanceAlarm,
  {
    readonly scheduleBy: (at: number) => Effect.Effect<void>;
    readonly scheduleAt: (at: number) => Effect.Effect<void>;
  }
>()("@store/server/MaintenanceAlarm") {}

export class LiveBroadcast extends Context.Service<
  LiveBroadcast,
  { readonly publish: (fanout: CommitFanout) => Effect.Effect<void> }
>()("@store/server/LiveBroadcast") {}

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

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* SecureRandom.SecureRandom;
  const alarm = yield* MaintenanceAlarm;
  const digest = yield* Digest.Digest;
  const live = yield* LiveBroadcast;
  const mintId = Effect.map(crypto.uuidV4(), (uuid) => uuid.replaceAll("-", ""));
  yield* migrateAuthority(sql).pipe(Effect.orDie);
  const db = yield* makeReplicaDb(sql);
  const engine = makeAuthorityEngine(sql, db);
  const snapshots = makeAuthoritySnapshots(engine, db, mintId);
  const imports = makeAuthorityImports(sql, engine, db, snapshots);
  const maintenance = makeAuthorityMaintenance(engine, db, snapshots);

  const soon = Effect.flatMap(Clock.currentTimeMillis, (now) =>
    alarm.scheduleBy(now + MAINTENANCE_INTERVAL_MILLIS),
  );

  const serve = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    replyOf(Effect.provideService(effect, Digest.Digest, digest));

  const serveWrite = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    serve(Effect.tap(effect, () => soon));

  const broadcast = <E, R>(effect: Effect.Effect<EncodedCommit, E, R>) =>
    effect.pipe(
      Effect.tap((commit) => (commit.fanout === null ? Effect.void : live.publish(commit.fanout))),
      Effect.map((commit) => commit.json),
    );

  const register = Effect.fn("OrgAuthority.register")(function* (
    actor: Actor,
    request: RegisterReplicaRequest,
  ) {
    return yield* serveWrite(
      engine.register(actor, request, yield* Clock.currentTimeMillis, yield* mintId),
    );
  });

  const submit = Effect.fn("OrgAuthority.submit")(function* (actor: Actor, bodyText: string) {
    return yield* serveWrite(
      broadcast(engine.submit(actor, bodyText, yield* Clock.currentTimeMillis, pullByteBudget)),
    );
  });

  const receipt = Effect.fn("OrgAuthority.receipt")(function* (actor: Actor, operationId: string) {
    return yield* serve(engine.receipt(actor, operationId));
  });

  const pull = Effect.fn("OrgAuthority.pull")(function* (actor: Actor, request: SyncPullRequest) {
    return yield* serve(
      engine.pull(actor, {
        epoch: request.epoch,
        subscription: request.subscription,
        afterCommitSequence: request.afterCommitSequence,
        maxGroups: PULL_MAX_GROUPS,
        byteBudget: pullByteBudget(request.maxBytes),
        digestVersion: request.digestVersion,
      }),
    );
  });

  const acquireSnapshot = Effect.fn("OrgAuthority.acquireSnapshot")(function* (
    actor: Actor,
    request: AcquireSnapshotRequest,
  ) {
    return yield* serveWrite(
      snapshots.acquire(
        actor,
        {
          epoch: request.epoch,
          subscription: request.subscription,
          replicaId: request.replicaId,
        },
        SYNC_SCHEMA_VERSION,
        yield* Clock.currentTimeMillis,
        SNAPSHOT_POLICY,
      ),
    );
  });

  const readSnapshotPart = Effect.fn("OrgAuthority.readSnapshotPart")(function* (
    actor: Actor,
    snapshotId: string,
    partNumber: number,
  ) {
    return yield* serve(snapshots.readPart(actor, snapshotId, partNumber));
  });

  const liveHorizon = Effect.fn("OrgAuthority.liveHorizon")(function* (
    actor: Actor,
    replicaId: string,
  ) {
    return yield* serve(engine.liveHorizon(actor, replicaId, yield* Clock.currentTimeMillis));
  });

  const stageImportPart = Effect.fn("OrgAuthority.stageImportPart")(function* (
    _actor: Actor,
    importId: string,
    partNumber: number,
    bodyText: string,
  ) {
    return yield* serveWrite(
      imports.stagePart(
        importId,
        partNumber,
        bodyText,
        yield* Clock.currentTimeMillis,
        IMPORT_LIMITS,
      ),
    );
  });

  const commitImport = Effect.fn("OrgAuthority.commitImport")(function* (
    actor: Actor,
    importId: string,
    request: ImportCatalogRequest,
  ) {
    return yield* serveWrite(
      broadcast(
        imports.commit(actor, importId, request, yield* Clock.currentTimeMillis, yield* mintId),
      ),
    );
  });

  const importStatus = Effect.fn("OrgAuthority.importStatus")(function* (
    _actor: Actor,
    importId: string,
  ) {
    return yield* serve(imports.status(importId));
  });

  const maintain = Effect.fn("OrgAuthority.maintain")(
    function* () {
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
    },
    Effect.provideService(Digest.Digest, digest),
    Effect.orDie,
  );

  return OrgAuthorityFacade.of({
    register,
    submit,
    receipt,
    pull,
    acquireSnapshot,
    readSnapshotPart,
    liveHorizon,
    stageImportPart,
    commitImport,
    importStatus,
    maintain,
  });
});

export class OrgAuthorityFacade extends Context.Service<OrgAuthorityFacade, OrgAuthorityApi>()(
  "@store/server/OrgAuthorityFacade",
) {
  static readonly layer = Layer.effect(OrgAuthorityFacade, make);
}
