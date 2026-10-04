import { describe, expect, it } from "@effect/vitest";
import {
  AuthorityIncarnation,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SyncEpoch,
  type SyncPullResult,
  type SyncTransactionGroup,
} from "@store/contracts";

import {
  admitAuthority,
  type AuthorityCursor,
  type AuthorityPayload,
} from "../src/replica/admission-authority";
import { transactionsFrame } from "./lib/authority";

const cursor: AuthorityCursor = {
  epoch: "1",
  incarnation: "authority-a",
  appliedCommitSequence: "9",
};

const group = (commitSequence: string): SyncTransactionGroup => ({
  commitSequence: OrgCommitSequence.make(commitSequence),
  operationId: `operation-${commitSequence}`,
  decision: "accepted",
  changes: [],
});

const groups = (...sequences: ReadonlyArray<string>) => sequences.map(group);

const page = (
  sequences: ReadonlyArray<string>,
  overrides: Partial<Record<"epoch" | "incarnation" | "next" | "horizon", string>> = {},
): SyncPullResult => {
  const next = overrides.next ?? sequences.at(-1) ?? cursor.appliedCommitSequence;
  return {
    epoch: SyncEpoch.make(overrides.epoch ?? cursor.epoch),
    incarnation: AuthorityIncarnation.make(overrides.incarnation ?? cursor.incarnation),
    subscription: OPERATIONAL_SUBSCRIPTION,
    schemaVersion: 1,
    transactions: groups(...sequences),
    nextCommitSequence: OrgCommitSequence.make(next),
    horizon: OrgCommitSequence.make(overrides.horizon ?? next),
    retentionFloor: OrgCommitSequence.make("0"),
  };
};

const pullPage = (...args: Parameters<typeof page>): AuthorityPayload => ({
  _tag: "pullPage",
  page: page(...args),
});

const frame = (
  sequences: ReadonlyArray<string>,
  overrides: Partial<Record<"epoch" | "from" | "to", string>> = {},
): AuthorityPayload => {
  const coherent = transactionsFrame(overrides.epoch ?? cursor.epoch, groups(...sequences));
  return {
    _tag: "liveFrame",
    frame: {
      ...coherent,
      fromCommitSequence: OrgCommitSequence.make(overrides.from ?? coherent.fromCommitSequence),
      toCommitSequence: OrgCommitSequence.make(overrides.to ?? coherent.toCommitSequence),
    },
  };
};

const apply = (...sequences: ReadonlyArray<string>) => ({
  _tag: "apply",
  groups: groups(...sequences),
  through: sequences.at(-1),
});

const hint = (epoch: string, horizon: string) => ({
  _tag: "pull",
  hint: { epoch, subscription: OPERATIONAL_SUBSCRIPTION, horizon },
});

const refuse = (code: string) => ({ _tag: "refuse", error: { code } });

const cases: ReadonlyArray<readonly [string, AuthorityPayload, object]> = [
  [
    "a page from another epoch is refused",
    pullPage(["10"], { epoch: "2" }),
    refuse("EPOCH_MISMATCH"),
  ],
  [
    "a submit page from another epoch is refused",
    { _tag: "submitPage", page: page(["10"], { epoch: "2" }) },
    refuse("EPOCH_MISMATCH"),
  ],
  [
    "a candidate page from another incarnation is refused",
    { _tag: "candidatePage", page: page(["10"], { incarnation: "authority-b" }) },
    refuse("INCARNATION_MISMATCH"),
  ],
  [
    "the epoch is checked before the incarnation",
    pullPage(["10"], { epoch: "2", incarnation: "authority-b" }),
    refuse("EPOCH_MISMATCH"),
  ],
  [
    "identity is checked before the page shape",
    pullPage(["10", "12"], { incarnation: "authority-b" }),
    refuse("INCARNATION_MISMATCH"),
  ],
  ["a page whose groups skip a commit asks for a pull", pullPage(["10", "12"]), { _tag: "pull" }],
  ["a page whose groups repeat a commit asks for a pull", pullPage(["10", "10"]), { _tag: "pull" }],
  ["a page whose groups run backwards asks for a pull", pullPage(["11", "10"]), { _tag: "pull" }],
  [
    "a page that ends somewhere other than its last group asks for a pull",
    pullPage(["10"], { next: "11", horizon: "11" }),
    { _tag: "pull" },
  ],
  [
    "a page whose horizon is behind its end asks for a pull",
    pullPage(["10", "11"], { horizon: "10" }),
    { _tag: "pull" },
  ],
  [
    "a contradictory page asks for a pull even when the replica already holds it",
    pullPage(["7", "9"]),
    { _tag: "pull" },
  ],
  ["an empty page is current", pullPage([]), { _tag: "current" }],
  [
    "an empty page behind a later horizon is current",
    pullPage([], { horizon: "40" }),
    { _tag: "current" },
  ],
  ["a page the replica already holds is current", pullPage(["8", "9"]), { _tag: "current" }],
  [
    "a page that starts past the next commit asks for a pull",
    pullPage(["11", "12"]),
    { _tag: "pull" },
  ],
  ["a page that continues the replica applies", pullPage(["10", "11"]), apply("10", "11")],
  ["a page behind a later horizon applies", pullPage(["10"], { horizon: "40" }), apply("10")],
  [
    "a page that overlaps the replica applies only the new commits",
    pullPage(["8", "9", "10"]),
    apply("10"),
  ],
  [
    "sequences compare as decimals of any length",
    {
      _tag: "pullPage",
      page: page(["100000000000000000000000000000000000000"]),
    },
    { _tag: "pull" },
  ],
  [
    "a frame from another epoch asks for a pull at its end",
    frame(["10"], { epoch: "2" }),
    hint("2", "10"),
  ],
  ["a frame without groups asks for a pull", frame([], { from: "10", to: "10" }), hint("1", "10")],
  [
    "a frame that starts somewhere other than its first group asks for a pull",
    frame(["10"], { from: "9" }),
    hint("1", "10"),
  ],
  [
    "a frame that ends somewhere other than its last group asks for a pull",
    frame(["10"], { to: "12" }),
    hint("1", "12"),
  ],
  ["a frame whose groups skip a commit asks for a pull", frame(["10", "12"]), hint("1", "12")],
  ["a frame the replica already holds is current", frame(["8", "9"]), { _tag: "current" }],
  ["a frame that starts past the next commit asks for a pull", frame(["11"]), hint("1", "11")],
  ["a frame that continues the replica applies", frame(["10", "11"]), apply("10", "11")],
  [
    "a frame that overlaps the replica applies only the new commits",
    frame(["9", "10"]),
    apply("10"),
  ],
];

describe("authority admission", () => {
  it.each(cases)("%s", (_name, payload, expected) => {
    expect(admitAuthority(cursor, payload)).toMatchObject(expected);
  });

  it("carries a wide cursor across a digit boundary", () => {
    const wide = "99999999999999999999999999999999999999";
    const next = "100000000000000000000000000000000000000";
    expect(
      admitAuthority(
        { ...cursor, appliedCommitSequence: wide },
        { _tag: "pullPage", page: page([next]) },
      ),
    ).toMatchObject(apply(next));
  });
});
