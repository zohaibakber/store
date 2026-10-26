import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import {
  AuthorityIncarnation,
  OrgCommitSequence,
  ReplicaClientSequence,
  SyncEpoch,
  syncProtocolError,
  OperationId,
} from "@store/contracts";
import { ReplicaStore, SyncScheduler, SyncTransport } from "@store/sync";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { layerNodeReplicaSync } from "../src/replica/node-sync";
import { syncHealthOf } from "../src/replica/status";

const failingTransport = (snapshotRequests: Queue.Queue<void>) =>
  Layer.mock(SyncTransport, {
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
    pull: () => Effect.fail(syncProtocolError("EPOCH_MISMATCH", "The authority epoch changed.")),
    acquireSnapshot: () =>
      Queue.offer(snapshotRequests, undefined).pipe(
        Effect.andThen(
          Effect.fail(syncProtocolError("EPOCH_MISMATCH", "The authority epoch changed.")),
        ),
      ),
  });

describe("layerNodeReplicaSync", () => {
  it.effect("reports a recovery-required suspension and still answers an explicit wake", () =>
    Effect.gen(function* () {
      const snapshotRequests = yield* Queue.unbounded<void>();
      const session = yield* Layer.build(
        Layer.fresh(
          layerNodeReplicaSync({
            path: ":memory:",
            identity: { organizationId: "org-1", userId: "user-1", replicaId: "replica-1" },
            databaseIdentity: "node-sync-recovery",
            transport: failingTransport(snapshotRequests),
            live: { apiBaseUrl: "https://api.example.com", accessToken: async () => null },
          }).pipe(Layer.provide(NodeCrypto.layer)),
        ),
      );
      const scheduler = Context.get(session, SyncScheduler);
      const suspended = yield* scheduler.state.pipe(
        Stream.map(syncHealthOf),
        Stream.filter((health) => health._tag === "recoveryRequired"),
        Stream.runHead,
      );
      expect(suspended).toEqual(
        Option.some({
          _tag: "recoveryRequired",
          message: "The sync authority was restored or re-keyed; unsent commands are preserved.",
        }),
      );
      expect(
        yield* Context.get(session, ReplicaStore).readCommandStatus(
          OperationId.make("unknown-operation"),
        ),
      ).toBeUndefined();
      yield* Queue.clear(snapshotRequests);
      yield* scheduler.wake("focus");
      yield* Queue.take(snapshotRequests);
      const afterWake = yield* Stream.runHead(Stream.map(scheduler.state, syncHealthOf));
      expect(Option.map(afterWake, (health) => health._tag)).toEqual(
        Option.some("recoveryRequired"),
      );
    }),
  );
});
