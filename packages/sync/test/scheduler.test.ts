import { describe, expect, it } from "@effect/vitest";
import {
  AuthorityIncarnation,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  ReplicaClientSequence,
  type SyncPullRequest,
  type SyncPullResult,
  type SyncTransactionGroup,
} from "@store/contracts";
import { LAST_UNIT_EPOCH } from "@store/contracts/sync/fixtures";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import { defaultHttpPollPolicy } from "../src/scheduler";
import { isFollowing } from "../src/sync-state";
import {
  SyncTransportGarbled,
  SyncTransportUnavailable,
  type SyncTransport,
} from "../src/transport";
import { sqliteScheduler, stubTransport } from "./lib/engine-fixture";
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

const registered: SyncTransport["Service"]["registerReplica"] = (request) =>
  Effect.succeed({
    replicaId: request.replicaId,
    epoch: LAST_UNIT_EPOCH,
    incarnation: AuthorityIncarnation.make("incarnation-test"),
    nextClientSequence: ReplicaClientSequence.make("1"),
    retentionFloor: OrgCommitSequence.make("0"),
    horizon: OrgCommitSequence.make("0"),
    schemaVersion: 1,
  });

const settle = Effect.forEach(Array.from({ length: 50 }), () => Effect.yieldNow, { discard: true });

const retriesAfter = (retryAfterMillis: number, retryDelayMillis: number) =>
  withSeededReplica((handle) =>
    Effect.gen(function* () {
      const pulls = yield* Ref.make(0);
      const transport = stubTransport({
        registerReplica: registered,
        pull: (request) =>
          Ref.getAndUpdate(pulls, (n) => n + 1).pipe(
            Effect.flatMap((previous) =>
              previous === 0
                ? Effect.fail(
                    new SyncTransportUnavailable({
                      message: "Too many requests.",
                      status: 429,
                      retryAfterMillis,
                    }),
                  )
                : Effect.succeed(page(request, [])),
            ),
          ),
      });
      const scheduler = yield* sqliteScheduler(handle, transport, defaultHttpPollPolicy, {
        recovers: false,
      });
      yield* scheduler.setNetworkOwner(true);
      yield* settle;
      expect(yield* Ref.get(pulls)).toBe(1);
      yield* TestClock.adjust(Duration.millis(retryDelayMillis - 1_000));
      yield* settle;
      expect(yield* Ref.get(pulls)).toBe(1);
      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(yield* Ref.get(pulls)).toBe(2);
    }),
  );

describe("sync scheduler", () => {
  it.effect("honours a Retry-After shorter than the cap", () => retriesAfter(90_000, 90_000));

  it.effect("caps a Retry-After at the policy maximum", () => retriesAfter(86_400_000, 300_000));

  it.effect("catches up on its own timer after a garbled pull", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        const pulls = yield* Ref.make(0);
        const garbled = yield* Deferred.make<void>();
        const transport = stubTransport({
          registerReplica: (request) =>
            Effect.succeed({
              replicaId: request.replicaId,
              epoch: LAST_UNIT_EPOCH,
              incarnation: AuthorityIncarnation.make("incarnation-test"),
              nextClientSequence: ReplicaClientSequence.make("1"),
              retentionFloor: OrgCommitSequence.make("0"),
              horizon: OrgCommitSequence.make("0"),
              schemaVersion: 1,
            }),
          pull: (request) =>
            Effect.gen(function* () {
              if ((yield* Ref.getAndUpdate(pulls, (n) => n + 1)) === 0) {
                yield* Deferred.succeed(garbled, undefined);
                return yield* new SyncTransportGarbled({ message: "<html>Sign in</html>" });
              }
              return page(request, request.afterCommitSequence === "0" ? [seedCatalogGroup] : []);
            }),
        });
        const scheduler = yield* sqliteScheduler(handle, transport, defaultHttpPollPolicy, {
          recovers: false,
        });
        const states = scheduler.state;
        yield* scheduler.setNetworkOwner(true);
        yield* Deferred.await(garbled);
        yield* states.pipe(
          Stream.filter((state) => state.phase === "idle"),
          Stream.runHead,
        );
        expect(Option.getOrThrow(yield* Stream.runHead(scheduler.state)).suspended).toBeUndefined();
        for (let turn = 0; turn < 20 && (yield* Ref.get(pulls)) < 2; turn += 1) {
          yield* TestClock.adjust("7 minutes");
        }
        const following = yield* states.pipe(Stream.filter(isFollowing), Stream.runHead);
        expect(following._tag).toBe("Some");
        const store = yield* makeSqliteReplicaStore(handle, "sqlite");
        expect((yield* store.readSyncCursor).appliedCommitSequence).toBe("1");
        const settled = yield* states.pipe(
          Stream.filter((state) => state.phase === "following"),
          Stream.runHead,
        );
        expect(settled._tag).toBe("Some");
      }),
    ),
  );
});
