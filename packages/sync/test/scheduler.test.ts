import { describe, expect, it } from "@effect/vitest";
import {
  AuthorityIncarnation,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  type SyncPullRequest,
  type SyncPullResult,
  type SyncTransactionGroup,
} from "@store/contracts";
import { LAST_UNIT_EPOCH } from "@store/contracts/sync/fixtures";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { TestClock } from "effect/testing";

import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import { defaultHttpPollPolicy, SyncScheduler } from "../src/scheduler";
import { isFollowing } from "../src/sync-state";
import { SyncTransportGarbled } from "../src/transport";
import { sqliteEngine, stubTransport } from "./lib/engine-fixture";
import { seedCatalogGroup } from "./lib/pending-fixture";
import { withSeededReplica } from "./lib/replica-fixture";

const page = (
  request: SyncPullRequest,
  transactions: ReadonlyArray<SyncTransactionGroup>,
): SyncPullResult => ({
  epoch: LAST_UNIT_EPOCH,
  incarnation: AuthorityIncarnation.make("incarnation-test"),
  subscription: OPERATIONAL_SUBSCRIPTION,
  schemaVersion: 1,
  transactions,
  nextCommitSequence: transactions.at(-1)?.commitSequence ?? request.afterCommitSequence,
  horizon: OrgCommitSequence.make("1"),
  retentionFloor: OrgCommitSequence.make("0"),
});

describe("sync scheduler", () => {
  it.effect("catches up on its own timer after a garbled pull", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        const pulls = yield* Ref.make(0);
        const garbled = yield* Deferred.make<void>();
        const transport = stubTransport({
          pull: (request) =>
            Effect.gen(function* () {
              if ((yield* Ref.getAndUpdate(pulls, (n) => n + 1)) === 0) {
                yield* Deferred.succeed(garbled, undefined);
                return yield* new SyncTransportGarbled({ message: "<html>Sign in</html>" });
              }
              return page(request, request.afterCommitSequence === "0" ? [seedCatalogGroup] : []);
            }),
        });
        const engine = yield* sqliteEngine(handle, transport);
        const scheduler = yield* SyncScheduler.make(
          {
            drainUpload: () => engine.drainUploads().pipe(Effect.asVoid),
            catchUp: () => engine.catchUp(),
          },
          defaultHttpPollPolicy,
          engine.state,
        );
        const states = SubscriptionRef.changes(scheduler.state);
        yield* scheduler.setNetworkOwner(true);
        yield* Deferred.await(garbled);
        yield* states.pipe(
          Stream.filter((state) => state.phase === "idle"),
          Stream.runHead,
        );
        expect((yield* SubscriptionRef.get(scheduler.state)).suspended).toBeUndefined();
        for (let turn = 0; turn < 20 && (yield* Ref.get(pulls)) < 2; turn += 1) {
          yield* TestClock.adjust("7 minutes");
        }
        const following = yield* states.pipe(Stream.filter(isFollowing), Stream.runHead);
        expect(following._tag).toBe("Some");
        const store = yield* makeSqliteReplicaStore(handle, "sqlite");
        expect((yield* store.readSyncCursor()).appliedCommitSequence).toBe("1");
        const settled = yield* states.pipe(
          Stream.filter((state) => state.phase === "following"),
          Stream.runHead,
        );
        expect(settled._tag).toBe("Some");
      }),
    ),
  );
});
