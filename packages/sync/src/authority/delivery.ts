import {
  canonicalJson,
  compareDecimalSequence,
  LIVE_TICKET_LIFETIME_MILLIS,
  MAX_LIVE_FRAME_TRANSACTIONS,
  MAX_TRANSPORT_PAYLOAD_BYTES,
  OrgCommitSequence,
  padDecimalSequence,
  SyncProtocolError,
  SyncSubscription,
  unpadDecimalSequence,
  type LiveResumeReason,
  type SyncTransactionGroup,
} from "@store/contracts";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  consumedTickets,
  inventoryState,
  liveSessions,
  replicas,
} from "@store/db/inventory.schema";
import { and, eq, lte } from "drizzle-orm";
import * as Schema from "effect/Schema";

import { runWrite, type SqliteConnection } from "../sqlite";
import { pullTransactions } from "./commands";

const utf8 = new TextEncoder();

const isSyncProtocolError = Schema.is(SyncProtocolError);

export type LiveSessionKey = {
  readonly organizationId: string;
  readonly sessionId: string;
};

export type MintedLiveTicket =
  | {
      readonly _tag: "minted";
      readonly nonce: string;
      readonly nonceHash: string;
      readonly expiresAt: number;
    }
  | { readonly _tag: "rejected"; readonly reason: "replica_unknown" | "nonce_reused" };

export type ConsumedLiveTicket =
  | { readonly _tag: "consumed"; readonly nonceHash: string; readonly expiresAt: number }
  | { readonly _tag: "rejected"; readonly reason: "ticket_invalid" };

export type DeliveryDecision =
  | { readonly _tag: "idle" }
  | {
      readonly _tag: "resume";
      readonly sessionId: string;
      readonly reason: LiveResumeReason;
      readonly fromCommitSequence: OrgCommitSequence;
    }
  | {
      readonly _tag: "send";
      readonly sessionId: string;
      readonly fromCommitSequence: OrgCommitSequence;
      readonly toCommitSequence: OrgCommitSequence;
      readonly transactions: ReadonlyArray<SyncTransactionGroup>;
    };

export type SessionAcknowledge =
  | { readonly _tag: "acknowledged"; readonly throughCommitSequence: OrgCommitSequence }
  | { readonly _tag: "resume"; readonly reason: LiveResumeReason };

export type OpenLiveSessionInput = {
  readonly organizationId: string;
  readonly sessionId: string;
  readonly replicaId: string;
  readonly ownerUserId: string;
  readonly subscription: SyncSubscription;
  readonly deliveredThroughCommitSequence: string;
  readonly leaseExpiresAt: number;
};

const nonceHashOf = (nonce: string): string => canonicalPayloadHash(nonce);

const loadHead = (tx: SqliteConnection, organizationId: string) =>
  tx.select().from(inventoryState).where(eq(inventoryState.organizationId, organizationId)).get();

export const mintLiveTicket = (
  tx: SqliteConnection,
  organizationId: string,
  replicaId: string,
  nonce: string,
  now: number,
): MintedLiveTicket => {
  const replica = tx
    .select()
    .from(replicas)
    .where(and(eq(replicas.organizationId, organizationId), eq(replicas.replicaId, replicaId)))
    .get();
  if (!replica) return { _tag: "rejected", reason: "replica_unknown" };
  const nonceHash = nonceHashOf(nonce);
  const expiresAt = now + LIVE_TICKET_LIFETIME_MILLIS;
  const inserted = tx
    .insert(consumedTickets)
    .values({ organizationId, nonceHash, expiresAt })
    .onConflictDoNothing({
      target: [consumedTickets.organizationId, consumedTickets.nonceHash],
    })
    .returning()
    .get();
  if (!inserted) return { _tag: "rejected", reason: "nonce_reused" };
  return { _tag: "minted", nonce, nonceHash, expiresAt };
};

export const consumeLiveTicket = (
  tx: SqliteConnection,
  organizationId: string,
  nonce: string,
  now: number,
): ConsumedLiveTicket => {
  const nonceHash = nonceHashOf(nonce);
  const row = tx
    .select()
    .from(consumedTickets)
    .where(
      and(
        eq(consumedTickets.organizationId, organizationId),
        eq(consumedTickets.nonceHash, nonceHash),
      ),
    )
    .get();
  if (!row || row.expiresAt <= now) return { _tag: "rejected", reason: "ticket_invalid" };
  runWrite(
    tx
      .delete(consumedTickets)
      .where(
        and(
          eq(consumedTickets.organizationId, organizationId),
          eq(consumedTickets.nonceHash, nonceHash),
        ),
      ),
  );
  return { _tag: "consumed", nonceHash, expiresAt: row.expiresAt };
};

export const openLiveSession = (tx: SqliteConnection, input: OpenLiveSessionInput): void => {
  runWrite(
    tx.insert(liveSessions).values({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      replicaId: input.replicaId,
      ownerUserId: input.ownerUserId,
      subscription: input.subscription,
      deliveredThroughCommitSequence: padDecimalSequence(input.deliveredThroughCommitSequence),
      leaseExpiresAt: input.leaseExpiresAt,
    }),
  );
};

export const closeLiveSession = (
  tx: SqliteConnection,
  organizationId: string,
  sessionId: string,
): void => {
  runWrite(
    tx
      .delete(liveSessions)
      .where(
        and(eq(liveSessions.organizationId, organizationId), eq(liveSessions.sessionId, sessionId)),
      ),
  );
};

export const recordDelivered = (
  tx: SqliteConnection,
  organizationId: string,
  sessionId: string,
  throughCommitSequence: string,
): void => {
  runWrite(
    tx
      .update(liveSessions)
      .set({ deliveredThroughCommitSequence: padDecimalSequence(throughCommitSequence) })
      .where(
        and(eq(liveSessions.organizationId, organizationId), eq(liveSessions.sessionId, sessionId)),
      ),
  );
};

export const acknowledgeLiveSession = (
  tx: SqliteConnection,
  organizationId: string,
  sessionId: string,
  throughCommitSequence: string,
  now: number,
): SessionAcknowledge => {
  const session = tx
    .select()
    .from(liveSessions)
    .where(
      and(eq(liveSessions.organizationId, organizationId), eq(liveSessions.sessionId, sessionId)),
    )
    .get();
  if (!session) return { _tag: "resume", reason: "send_window_lost" };
  if (session.leaseExpiresAt <= now) return { _tag: "resume", reason: "lease_expired" };
  const delivered = unpadDecimalSequence(session.deliveredThroughCommitSequence);
  if (compareDecimalSequence(throughCommitSequence, delivered) > 0) {
    return { _tag: "resume", reason: "send_window_lost" };
  }
  const state = loadHead(tx, organizationId);
  if (
    state &&
    compareDecimalSequence(throughCommitSequence, unpadDecimalSequence(state.retentionFloor)) < 0
  ) {
    return { _tag: "resume", reason: "retention_passed" };
  }
  return {
    _tag: "acknowledged",
    throughCommitSequence: OrgCommitSequence.make(throughCommitSequence),
  };
};

export const pruneExpiredSessions = (
  tx: SqliteConnection,
  organizationId: string,
  now: number,
): ReadonlyArray<LiveSessionKey> => {
  const expired = tx
    .select()
    .from(liveSessions)
    .where(
      and(eq(liveSessions.organizationId, organizationId), lte(liveSessions.leaseExpiresAt, now)),
    )
    .all();
  for (const session of expired) {
    closeLiveSession(tx, organizationId, session.sessionId);
  }
  return expired.map((session) => ({
    organizationId,
    sessionId: session.sessionId,
  }));
};

export const pruneExpiredTickets = (
  tx: SqliteConnection,
  organizationId: string,
  now: number,
): number => {
  const expired = tx
    .select()
    .from(consumedTickets)
    .where(
      and(eq(consumedTickets.organizationId, organizationId), lte(consumedTickets.expiresAt, now)),
    )
    .all();
  for (const ticket of expired) {
    runWrite(
      tx
        .delete(consumedTickets)
        .where(
          and(
            eq(consumedTickets.organizationId, organizationId),
            eq(consumedTickets.nonceHash, ticket.nonceHash),
          ),
        ),
    );
  }
  return expired.length;
};

const frameBytes = (group: SyncTransactionGroup): number => {
  const encoded = canonicalJson(group);
  if (encoded === undefined) return 0;
  return utf8.encode(encoded).length;
};

const boundGroups = (
  groups: ReadonlyArray<SyncTransactionGroup>,
  limit: number,
): ReadonlyArray<SyncTransactionGroup> => {
  const selected: SyncTransactionGroup[] = [];
  let bytes = 0;
  for (const group of groups) {
    const size = frameBytes(group);
    if (
      selected.length > 0 &&
      (selected.length >= limit || bytes + size > MAX_TRANSPORT_PAYLOAD_BYTES)
    ) {
      break;
    }
    selected.push(group);
    bytes += size;
    if (selected.length >= limit) break;
  }
  return selected;
};

export const decideDelivery = (
  tx: SqliteConnection,
  organizationId: string,
  limit: number,
): DeliveryDecision => {
  const state = loadHead(tx, organizationId);
  if (!state || state.status !== "ready") return { _tag: "idle" };
  const head = unpadDecimalSequence(state.commitSequence);
  const sessions = tx
    .select()
    .from(liveSessions)
    .where(eq(liveSessions.organizationId, organizationId))
    .all();
  let chosen: (typeof sessions)[number] | undefined;
  for (const session of sessions) {
    if (
      compareDecimalSequence(unpadDecimalSequence(session.deliveredThroughCommitSequence), head) >=
      0
    ) {
      continue;
    }
    if (chosen === undefined) {
      chosen = session;
      continue;
    }
    if (
      compareDecimalSequence(
        session.deliveredThroughCommitSequence,
        chosen.deliveredThroughCommitSequence,
      ) < 0
    ) {
      chosen = session;
    }
  }
  if (chosen === undefined) return { _tag: "idle" };
  const from = unpadDecimalSequence(chosen.deliveredThroughCommitSequence);
  if (compareDecimalSequence(from, unpadDecimalSequence(state.retentionFloor)) < 0) {
    return {
      _tag: "resume",
      sessionId: chosen.sessionId,
      reason: "retention_passed",
      fromCommitSequence: OrgCommitSequence.make(unpadDecimalSequence(state.retentionFloor)),
    };
  }
  const maxFrames = Math.min(Math.max(limit, 1), MAX_LIVE_FRAME_TRANSACTIONS);
  try {
    const pulled = pullTransactions(tx, {
      organizationId,
      epoch: state.epoch,
      subscription: Schema.decodeUnknownSync(SyncSubscription)(chosen.subscription),
      afterCommitSequence: from,
      limit: maxFrames,
    });
    const transactions = boundGroups(pulled.transactions, maxFrames);
    const first = transactions.at(0);
    const last = transactions.at(-1);
    if (first === undefined || last === undefined) return { _tag: "idle" };
    return {
      _tag: "send",
      sessionId: chosen.sessionId,
      fromCommitSequence: first.commitSequence,
      toCommitSequence: last.commitSequence,
      transactions,
    };
  } catch (cause) {
    if (isSyncProtocolError(cause) && cause.code === "SNAPSHOT_REQUIRED") {
      return {
        _tag: "resume",
        sessionId: chosen.sessionId,
        reason: "retention_passed",
        fromCommitSequence: OrgCommitSequence.make(unpadDecimalSequence(state.retentionFloor)),
      };
    }
    throw cause;
  }
};
