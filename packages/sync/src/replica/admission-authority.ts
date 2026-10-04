import {
  compareDecimalSequence,
  incrementDecimalSequence,
  OPERATIONAL_SUBSCRIPTION,
  syncProtocolError,
  type OrgCommitSequence,
  type SyncLiveServerFrame,
  type SyncLiveWakeHint,
  type SyncProtocolError,
  type SyncPullResult,
  type SyncTransactionGroup,
} from "@store/contracts";

export type AuthorityCursor = {
  readonly epoch: string;
  readonly incarnation: string;
  readonly appliedCommitSequence: string;
};

type TransactionsFrame = Extract<SyncLiveServerFrame, { readonly _tag: "transactions" }>;

export type AuthorityPayload =
  | { readonly _tag: "pullPage"; readonly page: SyncPullResult }
  | { readonly _tag: "submitPage"; readonly page: SyncPullResult }
  | { readonly _tag: "candidatePage"; readonly page: SyncPullResult }
  | { readonly _tag: "liveFrame"; readonly frame: TransactionsFrame };

export type Admission =
  | {
      readonly _tag: "apply";
      readonly groups: ReadonlyArray<SyncTransactionGroup>;
      readonly through: OrgCommitSequence;
    }
  | { readonly _tag: "current" }
  | { readonly _tag: "pull"; readonly hint?: SyncLiveWakeHint }
  | { readonly _tag: "refuse"; readonly error: SyncProtocolError };

const CURRENT: Admission = { _tag: "current" };

const sameSequence = (left: string, right: string): boolean =>
  compareDecimalSequence(left, right) === 0;

const follows = (sequence: string, previous: string): boolean =>
  sameSequence(sequence, incrementDecimalSequence(previous));

const consecutive = (groups: ReadonlyArray<SyncTransactionGroup>): boolean =>
  groups.every((group, index) => {
    const previous = groups[index - 1];
    return previous === undefined || follows(group.commitSequence, previous.commitSequence);
  });

const endsAt = (groups: ReadonlyArray<SyncTransactionGroup>, to: string): boolean => {
  const last = groups.at(-1);
  return last === undefined || sameSequence(last.commitSequence, to);
};

const pageIsCoherent = (page: SyncPullResult): boolean =>
  consecutive(page.transactions) &&
  endsAt(page.transactions, page.nextCommitSequence) &&
  compareDecimalSequence(page.horizon, page.nextCommitSequence) >= 0;

const frameIsCoherent = (frame: TransactionsFrame): boolean => {
  const first = frame.transactions[0];
  return (
    first !== undefined &&
    sameSequence(first.commitSequence, frame.fromCommitSequence) &&
    consecutive(frame.transactions) &&
    endsAt(frame.transactions, frame.toCommitSequence)
  );
};

const admitGroups = (
  appliedCommitSequence: string,
  groups: ReadonlyArray<SyncTransactionGroup>,
  pull: Admission,
): Admission => {
  const due = groups.filter(
    (group) => compareDecimalSequence(group.commitSequence, appliedCommitSequence) > 0,
  );
  const first = due[0];
  const last = due.at(-1);
  if (first === undefined || last === undefined) return CURRENT;
  if (!follows(first.commitSequence, appliedCommitSequence)) return pull;
  return { _tag: "apply", groups: due, through: last.commitSequence };
};

const admitPage = (cursor: AuthorityCursor, page: SyncPullResult): Admission => {
  if (page.epoch !== cursor.epoch) {
    return {
      _tag: "refuse",
      error: syncProtocolError(
        "EPOCH_MISMATCH",
        `Expected epoch ${cursor.epoch}, received ${page.epoch}.`,
      ),
    };
  }
  if (page.incarnation !== cursor.incarnation) {
    return {
      _tag: "refuse",
      error: syncProtocolError(
        "INCARNATION_MISMATCH",
        `Expected incarnation ${cursor.incarnation}, received ${page.incarnation}.`,
      ),
    };
  }
  const pull: Admission = { _tag: "pull" };
  return pageIsCoherent(page)
    ? admitGroups(cursor.appliedCommitSequence, page.transactions, pull)
    : pull;
};

const admitFrame = (cursor: AuthorityCursor, frame: TransactionsFrame): Admission => {
  const pull: Admission = {
    _tag: "pull",
    hint: {
      epoch: frame.epoch,
      subscription: OPERATIONAL_SUBSCRIPTION,
      horizon: frame.toCommitSequence,
    },
  };
  if (frame.epoch !== cursor.epoch) return pull;
  return frameIsCoherent(frame)
    ? admitGroups(cursor.appliedCommitSequence, frame.transactions, pull)
    : pull;
};

export const admitAuthority = (cursor: AuthorityCursor, payload: AuthorityPayload): Admission =>
  payload._tag === "liveFrame"
    ? admitFrame(cursor, payload.frame)
    : admitPage(cursor, payload.page);

export type IntegrationOutcome =
  | { readonly _tag: "applied" }
  | { readonly _tag: "current" }
  | { readonly _tag: "pull"; readonly hint?: SyncLiveWakeHint }
  | { readonly _tag: "refused"; readonly error: SyncProtocolError };

export const APPLIED: IntegrationOutcome = { _tag: "applied" };

export const outcomeOfUnapplied = (
  admission: Exclude<Admission, { readonly _tag: "apply" }>,
): IntegrationOutcome =>
  admission._tag === "refuse" ? { _tag: "refused", error: admission.error } : admission;
