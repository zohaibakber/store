import {
  AuthorityIncarnation,
  OrgCommitSequence,
  ReplicaClientSequence,
  SyncEpoch,
  syncProtocolError,
} from "@store/contracts";
import { ReplicaStore, SyncScheduler, SyncTransportService, type SyncTransport } from "@store/sync";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { describe, expect, it, vi } from "vitest";

import { layerNodeReplicaSync } from "../src/replica/node-sync";
import { syncHealthOf, type ReplicaSyncHealth } from "../src/replica/status";

const failingTransport = (onSnapshotRequest: () => void): SyncTransport => ({
  registerReplica: (request) =>
    Effect.succeed({
      replicaId: request.replicaId,
      epoch: SyncEpoch.make("1"),
      incarnation: AuthorityIncarnation.make("authority-1"),
      nextClientSequence: ReplicaClientSequence.make("1"),
      retentionFloor: OrgCommitSequence.make("0"),
      horizon: OrgCommitSequence.make("0"),
      schemaVersion: 1,
    }),
  submitCommand: () => Effect.die("unused"),
  getReceipt: () => Effect.die("unused"),
  pull: () => Effect.fail(syncProtocolError("EPOCH_MISMATCH", "The authority epoch changed.")),
  acquireSnapshot: () =>
    Effect.suspend(() => {
      onSnapshotRequest();
      return Effect.fail(syncProtocolError("EPOCH_MISMATCH", "The authority epoch changed."));
    }),
  readSnapshotPart: () => Effect.die("unused"),
});

describe("layerNodeReplicaSync", () => {
  it("reports a recovery-required suspension and still answers an explicit wake", async () => {
    let snapshotRequests = 0;
    const scope = Effect.runSync(Scope.make());
    const session = await Effect.runPromise(
      Layer.buildWithScope(
        Layer.fresh(
          layerNodeReplicaSync({
            path: ":memory:",
            identity: { organizationId: "org-1", userId: "user-1", replicaId: "replica-1" },
            databaseIdentity: "node-sync-recovery",
            transport: Layer.succeed(
              SyncTransportService,
              failingTransport(() => {
                snapshotRequests += 1;
              }),
            ),
            live: { apiBaseUrl: "https://api.example.com", accessToken: async () => null },
          }),
        ),
        scope,
      ),
    );
    const scheduler = Context.get(session, SyncScheduler);
    const seen: Array<ReplicaSyncHealth> = [];
    Effect.runFork(
      SubscriptionRef.changes(scheduler.state).pipe(
        Stream.runForEach((state) => Effect.sync(() => seen.push(syncHealthOf(state)))),
        Effect.forkIn(scope),
      ),
    );
    await vi.waitFor(() => {
      expect(seen.at(-1)).toEqual({
        _tag: "recoveryRequired",
        message: "The sync authority was restored or re-keyed; unsent commands are preserved.",
      });
    });
    expect(
      await Effect.runPromise(
        Context.get(session, ReplicaStore).readCommandStatus("unknown-operation"),
      ),
    ).toBeUndefined();
    const requestsWhenSuspended = snapshotRequests;
    await Effect.runPromise(scheduler.wake("focus"));
    await vi.waitFor(() => {
      expect(snapshotRequests).toBeGreaterThan(requestsWhenSuspended);
    });
    expect(seen.at(-1)?._tag).toBe("recoveryRequired");
    await Effect.runPromise(Scope.close(scope, Exit.void));
  });
});
