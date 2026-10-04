import {
  AuthorityIncarnation,
  OrgCommitSequence,
  ReplicaClientSequence,
  SyncEpoch,
  syncProtocolError,
} from "@store/contracts";
import { SyncTransportService, type SyncTransport } from "@store/sync";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it, vi } from "vitest";

import { openNodeReplicaSyncSession } from "../src/replica/node-sync";
import type { ReplicaSyncHealth } from "../src/replica/status";

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

describe("openNodeReplicaSyncSession", () => {
  it("reports a recovery-required suspension and still answers an explicit wake", async () => {
    let snapshotRequests = 0;
    const session = await openNodeReplicaSyncSession({
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
    });
    const seen: Array<ReplicaSyncHealth> = [];
    const unsubscribe = session.subscribeSyncHealth((health) => {
      seen.push(health);
    });
    await vi.waitFor(() => {
      expect(seen.at(-1)).toEqual({
        _tag: "recoveryRequired",
        message: "The sync authority was restored or re-keyed; unsent commands are preserved.",
      });
    });
    expect(await session.readCommandStatus("unknown-operation")).toBeUndefined();
    const requestsWhenSuspended = snapshotRequests;
    await session.wake("focus");
    await vi.waitFor(() => {
      expect(snapshotRequests).toBeGreaterThan(requestsWhenSuspended);
    });
    expect(seen.at(-1)?._tag).toBe("recoveryRequired");
    unsubscribe();
    await session.close();
  });
});
