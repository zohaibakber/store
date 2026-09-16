import { compareDecimalSequence, unpadDecimalSequence } from "@store/contracts";
import {
  consumedTickets,
  inventoryState,
  liveSessions,
  snapshotJobs,
  wakeState,
} from "@store/db/inventory.schema";
import { and, eq, inArray } from "drizzle-orm";

import { runWrite, type SqliteConnection } from "../sqlite";

export type WakeReason = "delivery" | "leaseExpiry" | "snapshotStep" | "retention";

export const RETENTION_CADENCE_MILLIS = 60_000;

const ACTIVE_SNAPSHOT_STAGES = ["copying", "repairing", "frozen", "exporting"] as const;

class WakeArmed {
  private constructor(
    readonly organizationId: string,
    readonly dueAt: number,
    readonly reason: WakeReason,
  ) {}

  static readonly mint = (organizationId: string, dueAt: number, reason: WakeReason): WakeArmed =>
    new WakeArmed(organizationId, dueAt, reason);
}

export type { WakeArmed };

export type WakeDeadline = {
  readonly reason: WakeReason;
  readonly dueAt: number;
};

export type WakeDebt =
  | { readonly _tag: "settled" }
  | {
      readonly _tag: "overdue";
      readonly deadline: WakeDeadline;
      readonly armedDueAt: number;
    };

export const armWake = (organizationId: string, dueAt: number, reason: WakeReason): WakeArmed =>
  WakeArmed.mint(organizationId, dueAt, reason);

const earlier = (left: WakeArmed, right: WakeArmed): WakeArmed => {
  if (left.dueAt < right.dueAt) return left;
  if (right.dueAt < left.dueAt) return right;
  const rank = (reason: WakeReason): number => {
    switch (reason) {
      case "delivery":
        return 0;
      case "leaseExpiry":
        return 1;
      case "snapshotStep":
        return 2;
      case "retention":
        return 3;
    }
  };
  return rank(left.reason) <= rank(right.reason) ? left : right;
};

const behindHead = (deliveredThroughCommitSequence: string, commitSequence: string): boolean =>
  compareDecimalSequence(
    unpadDecimalSequence(deliveredThroughCommitSequence),
    unpadDecimalSequence(commitSequence),
  ) < 0;

export const nextWakeDeadline = (
  tx: SqliteConnection,
  organizationId: string,
  now: number,
): WakeArmed | undefined => {
  const state = tx
    .select()
    .from(inventoryState)
    .where(eq(inventoryState.organizationId, organizationId))
    .get();
  if (!state) return undefined;

  const candidates: WakeArmed[] = [
    armWake(organizationId, now + RETENTION_CADENCE_MILLIS, "retention"),
  ];

  const sessions = tx
    .select()
    .from(liveSessions)
    .where(eq(liveSessions.organizationId, organizationId))
    .all();
  for (const session of sessions) {
    if (behindHead(session.deliveredThroughCommitSequence, state.commitSequence)) {
      candidates.push(armWake(organizationId, now, "delivery"));
    }
    candidates.push(armWake(organizationId, session.leaseExpiresAt, "leaseExpiry"));
  }

  const tickets = tx
    .select()
    .from(consumedTickets)
    .where(eq(consumedTickets.organizationId, organizationId))
    .all();
  for (const ticket of tickets) {
    candidates.push(armWake(organizationId, ticket.expiresAt, "leaseExpiry"));
  }

  const jobs = tx
    .select()
    .from(snapshotJobs)
    .where(
      and(
        eq(snapshotJobs.organizationId, organizationId),
        inArray(snapshotJobs.stage, ACTIVE_SNAPSHOT_STAGES),
      ),
    )
    .all();
  for (const job of jobs) {
    candidates.push(armWake(organizationId, job.stepDueAt, "snapshotStep"));
  }

  return candidates.reduce(earlier);
};

export const recordArmedWake = (tx: SqliteConnection, armed: WakeArmed): void => {
  runWrite(
    tx
      .insert(wakeState)
      .values({
        organizationId: armed.organizationId,
        armedDueAt: armed.dueAt,
        reason: armed.reason,
      })
      .onConflictDoUpdate({
        target: wakeState.organizationId,
        set: {
          armedDueAt: armed.dueAt,
          reason: armed.reason,
        },
      }),
  );
};

export const wakeDebt = (tx: SqliteConnection, organizationId: string, now: number): WakeDebt => {
  const obligation = nextWakeDeadline(tx, organizationId, now);
  if (obligation === undefined) return { _tag: "settled" };
  const armed = tx
    .select()
    .from(wakeState)
    .where(eq(wakeState.organizationId, organizationId))
    .get();
  const deadline: WakeDeadline = { reason: obligation.reason, dueAt: obligation.dueAt };
  if (armed === undefined) {
    return {
      _tag: "overdue",
      deadline,
      armedDueAt: Number.MAX_SAFE_INTEGER,
    };
  }
  if (armed.armedDueAt <= obligation.dueAt) return { _tag: "settled" };
  return {
    _tag: "overdue",
    deadline,
    armedDueAt: armed.armedDueAt,
  };
};
