import {
  compareDecimalSequence,
  incrementDecimalSequence,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SyncEpoch,
  type SyncLiveServerFrame,
  type SyncTransactionGroup,
} from "@store/contracts";
import * as Effect from "effect/Effect";

import type { ReplicaStoreContract } from "../../src/replica/store";

type TransactionsFrame = Extract<SyncLiveServerFrame, { readonly _tag: "transactions" }>;

export const transactionsFrame = (
  epoch: string,
  groups: ReadonlyArray<SyncTransactionGroup>,
): TransactionsFrame => ({
  _tag: "transactions",
  epoch: SyncEpoch.make(epoch),
  subscription: OPERATIONAL_SUBSCRIPTION,
  schemaVersion: 1,
  fromCommitSequence: groups[0]?.commitSequence ?? OrgCommitSequence.make("0"),
  toCommitSequence: groups.at(-1)?.commitSequence ?? OrgCommitSequence.make("0"),
  transactions: groups,
});

const historyBefore = (
  appliedCommitSequence: string,
  commitSequence: string,
): ReadonlyArray<SyncTransactionGroup> => {
  const history: Array<SyncTransactionGroup> = [];
  let next = incrementDecimalSequence(appliedCommitSequence);
  while (compareDecimalSequence(next, commitSequence) < 0) {
    history.push({
      commitSequence: OrgCommitSequence.make(next),
      operationId: `unrelated-commit-${next}`,
      decision: "accepted",
      changes: [],
    });
    next = incrementDecimalSequence(next);
  }
  return history;
};

export const applyGroup = (
  store: Pick<ReplicaStoreContract, "readSyncCursor" | "integrateAuthority">,
  group: SyncTransactionGroup,
) =>
  Effect.gen(function* () {
    const cursor = yield* store.readSyncCursor();
    const groups = [...historyBefore(cursor.appliedCommitSequence, group.commitSequence), group];
    return yield* store.integrateAuthority({
      payload: { _tag: "liveFrame", frame: transactionsFrame(cursor.epoch, groups) },
    });
  });
