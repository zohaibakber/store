import { describe, expect, it } from "@effect/vitest";
import {
  AuthorityIncarnation,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SyncEpoch,
  type SyncLiveServerFrame,
  type SyncPullRequest,
  type SyncPullResult,
  type SyncTransactionGroup,
} from "@store/contracts";
import { LAST_UNIT_EPOCH } from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";

import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import { sqliteEngine, stubTransport } from "./lib/engine-fixture";
import { seedCatalogGroup, seedSpareBatchGroup } from "./lib/pending-fixture";
import { withSeededReplica } from "./lib/replica-fixture";

const page = (
  request: SyncPullRequest,
  transactions: ReadonlyArray<SyncTransactionGroup>,
  horizon: string,
): SyncPullResult => ({
  epoch: LAST_UNIT_EPOCH,
  incarnation: AuthorityIncarnation.make("incarnation-test"),
  subscription: OPERATIONAL_SUBSCRIPTION,
  schemaVersion: 1,
  transactions,
  nextCommitSequence: transactions.at(-1)?.commitSequence ?? request.afterCommitSequence,
  horizon: OrgCommitSequence.make(horizon),
  retentionFloor: OrgCommitSequence.make("0"),
});

const followingAtOne = stubTransport({
  pull: (request) =>
    Effect.succeed(
      request.afterCommitSequence === "0"
        ? page(request, [seedCatalogGroup], "1")
        : page(request, [], "1"),
    ),
});

const groupAt = (commitSequence: string): SyncTransactionGroup => ({
  ...seedSpareBatchGroup,
  commitSequence: OrgCommitSequence.make(commitSequence),
});

type TransactionsFrame = Extract<SyncLiveServerFrame, { readonly _tag: "transactions" }>;

const transactions = (
  groups: ReadonlyArray<SyncTransactionGroup>,
  epoch: string = LAST_UNIT_EPOCH,
): TransactionsFrame => ({
  _tag: "transactions",
  epoch: SyncEpoch.make(epoch),
  subscription: OPERATIONAL_SUBSCRIPTION,
  schemaVersion: 1,
  fromCommitSequence: groups[0]!.commitSequence,
  toCommitSequence: groups.at(-1)!.commitSequence,
  transactions: groups,
});

const hint = (horizon: string, epoch: string = LAST_UNIT_EPOCH) => ({
  epoch: SyncEpoch.make(epoch),
  subscription: OPERATIONAL_SUBSCRIPTION,
  horizon: OrgCommitSequence.make(horizon),
});

const followingEngine = Effect.fn(function* (
  handle: Parameters<Parameters<typeof withSeededReplica>[0]>[0],
) {
  const engine = yield* sqliteEngine(handle, followingAtOne);
  yield* engine.catchUp();
  const store = yield* makeSqliteReplicaStore(handle, "sqlite");
  const applied = store.readSyncCursor().pipe(Effect.map((cursor) => cursor.appliedCommitSequence));
  return { engine, applied };
});

describe("sync engine live frames", () => {
  it.effect("applies a contiguous frame through the pull-page path", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        const { engine, applied } = yield* followingEngine(handle);
        expect(yield* applied).toBe("1");
        const outcome = yield* engine.applyLiveFrame(transactions([groupAt("2")]));
        expect(outcome).toEqual({ _tag: "applied" });
        expect(yield* applied).toBe("2");
      }),
    ),
  );

  it.effect("treats a gap as a wake and leaves the cursor for the pull", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        const { engine, applied } = yield* followingEngine(handle);
        const outcome = yield* engine.applyLiveFrame(transactions([groupAt("3")]));
        expect(outcome).toEqual({ _tag: "pull", hint: hint("3") });
        expect(yield* applied).toBe("1");
      }),
    ),
  );

  it.effect("refuses a frame whose groups do not match its advertised range", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        const { engine, applied } = yield* followingEngine(handle);
        const outcome = yield* engine.applyLiveFrame({
          ...transactions([groupAt("4")]),
          fromCommitSequence: OrgCommitSequence.make("2"),
          toCommitSequence: OrgCommitSequence.make("4"),
        });
        expect(outcome._tag).toBe("pull");
        expect(yield* applied).toBe("1");
      }),
    ),
  );

  it.effect("sends a frame from another epoch down the pull path to epoch recovery", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        const { engine, applied } = yield* followingEngine(handle);
        const outcome = yield* engine.applyLiveFrame(transactions([groupAt("2")], "99"));
        expect(outcome).toEqual({ _tag: "pull", hint: hint("2", "99") });
        expect(yield* applied).toBe("1");
      }),
    ),
  );
});
