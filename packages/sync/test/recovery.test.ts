import { describe, expect, it } from "@effect/vitest";
import {
  SnapshotId,
  SyncEpoch,
  syncProtocolError,
  OPERATIONAL_SUBSCRIPTION,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { isSnapshotRequired, recoverRequiredSnapshot } from "../src/recovery";
import type { ReplicaStoreContract } from "../src/replica/store";
import type { SyncTransport } from "../src/transport";

const acquireRequest = {
  epoch: SyncEpoch.make("1"),
  subscription: OPERATIONAL_SUBSCRIPTION,
};

const unusedTransport = (acquireSnapshot: SyncTransport["acquireSnapshot"]): SyncTransport => ({
  registerReplica: () => Effect.die("unused"),
  submitCommand: () => Effect.die("unused"),
  getReceipt: () => Effect.die("unused"),
  pull: () => Effect.die("unused"),
  acquireSnapshot,
  readSnapshotPart: () => Effect.die("unused"),
  mintLiveTicket: () => Effect.die("unused"),
});

const unusedStore = {
  readSyncCursor: () =>
    Effect.succeed({
      epoch: "1",
      appliedCommitSequence: "0",
      replicaId: "replica-1",
      registered: true,
    }),
  adoptRegistration: () => Effect.die("unused"),
  beginSnapshotImport: () => Effect.die("unused begin"),
  importSnapshotPart: () => Effect.die("unused import"),
  activateSnapshot: () => Effect.die("unused activate"),
  readStamp: () => Effect.succeed({ generationId: "1", localCommitVersion: 0 }),
  enqueueCommand: () => Effect.die("unused"),
  claimNextUpload: () => Effect.die("unused"),
  settleUploadClaim: () => Effect.die("unused"),
  releaseUploadClaim: () => Effect.die("unused"),
  recoverStaleUploadClaims: () => Effect.die("unused"),
  verifyAuthority: () => Effect.die("unused"),
  markCoverageRepair: () => Effect.die("unused"),
  readDigestVerification: () => Effect.die("unused"),
  recordDigestVerification: () => Effect.die("unused"),
  applyRemotePage: () => Effect.die("unused"),
  applyTransactionGroup: () => Effect.die("unused"),
  readCommandStatus: () => Effect.die("unused"),
  readPendingMarks: () => Effect.die("unused"),
  recordCaughtUp: () => Effect.die("unused"),
  commits: Stream.empty,
} satisfies ReplicaStoreContract;

describe("snapshot recovery", () => {
  it("classifies SNAPSHOT_REQUIRED", () => {
    expect(isSnapshotRequired(syncProtocolError("SNAPSHOT_REQUIRED", "behind"))).toBe(true);
    expect(isSnapshotRequired(syncProtocolError("SNAPSHOT_UNAVAILABLE", "none"))).toBe(false);
  });

  it.effect("fails closed when acquireSnapshot reports no published snapshot", () =>
    Effect.gen(function* () {
      const transport = unusedTransport(() =>
        Effect.fail(syncProtocolError("SNAPSHOT_UNAVAILABLE", "No snapshot is published.")),
      );
      const result = yield* Effect.flip(
        recoverRequiredSnapshot(transport, unusedStore, acquireRequest),
      );
      expect(result).toMatchObject({ code: "SNAPSHOT_UNAVAILABLE" });
    }),
  );

  it.effect("fails closed on building acquire results without inventing capability", () =>
    Effect.gen(function* () {
      const transport = unusedTransport(() =>
        Effect.succeed({
          _tag: "building" as const,
          snapshotId: SnapshotId.make("snapshot-building"),
          retryAfterMillis: 5_000,
        }),
      );
      const result = yield* Effect.flip(
        recoverRequiredSnapshot(transport, unusedStore, acquireRequest),
      );
      expect(result).toMatchObject({ code: "SNAPSHOT_UNAVAILABLE" });
    }),
  );
});
