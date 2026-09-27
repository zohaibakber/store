import {
  LIVE_TICKET_LIFETIME_MILLIS,
  LiveTicket,
  LiveTicketNonce,
  LiveTicketRequest,
  OrgCommitSequence,
  SyncEpoch,
} from "@store/contracts";
import { decodeOrganizationId } from "@store/contracts/ids";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import { consumedTickets } from "@store/db/postgres/schema";
import { and, eq } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { InventoryError } from "./errors";
import type { InventoryActor } from "./model";
import {
  integerTextFromNumeric,
  inventoryPostgresUnavailable,
  protocol,
  randomHex,
  readReadyState,
  readReplica,
  runTransaction,
  type InventoryDrizzle,
  type InventoryTransaction,
} from "./postgres";

type LiveHorizon = {
  readonly epoch: SyncEpoch;
  readonly horizon: OrgCommitSequence;
};

type LiveTicketQuery = {
  readonly nonce: string;
  readonly replicaId: string;
  readonly subscription: string;
};

const requireTicketReplica = Effect.fn("InventoryLive.requireTicketReplica")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  replicaId: string,
) {
  yield* readReadyState(tx, actor.organizationId);
  const replica = yield* readReplica(tx, actor.organizationId, replicaId);
  if (!replica) {
    return yield* protocol("TICKET_INVALID", "The replica is not registered.");
  }
  if (replica.ownerUserId !== actor.userId) {
    return yield* protocol("REPLICA_OWNED_BY_OTHER", "This replica belongs to another user.");
  }
});

const mintLiveTicketInTransaction = Effect.fn("InventoryLive.mintInTransaction")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  request: LiveTicketRequest,
  now: number,
) {
  yield* requireTicketReplica(tx, actor, request.replicaId);
  const nonce = Schema.decodeUnknownSync(LiveTicketNonce)(randomHex(32));
  const nonceHash = canonicalPayloadHash(nonce);
  const expiresAt = now + LIVE_TICKET_LIFETIME_MILLIS;
  const inserted = yield* tx
    .insert(consumedTickets)
    .values({ organizationId: actor.organizationId, nonceHash, expiresAt })
    .onConflictDoNothing({ target: [consumedTickets.organizationId, consumedTickets.nonceHash] })
    .returning();
  if (inserted.length === 0) {
    return yield* protocol("TICKET_INVALID", "The live ticket nonce was reused.");
  }
  return {
    nonce,
    organizationId: decodeOrganizationId(actor.organizationId),
    subscription: request.subscription,
    expiresAt,
  } satisfies LiveTicket;
});

const consumeLiveTicketInTransaction = Effect.fn("InventoryLive.consumeInTransaction")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  query: LiveTicketQuery,
  now: number,
) {
  yield* requireTicketReplica(tx, actor, query.replicaId);
  const ticket = and(
    eq(consumedTickets.organizationId, actor.organizationId),
    eq(consumedTickets.nonceHash, canonicalPayloadHash(query.nonce)),
  );
  const [row] = yield* tx.select().from(consumedTickets).where(ticket).limit(1);
  if (!row || row.expiresAt <= now) {
    return yield* protocol("TICKET_INVALID", "The live ticket is invalid or expired.");
  }
  yield* tx.delete(consumedTickets).where(ticket);
});

const readLiveHorizonInTransaction = Effect.fn("InventoryLive.readHorizonInTransaction")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
) {
  const state = yield* readReadyState(tx, actor.organizationId);
  return {
    epoch: SyncEpoch.make(state.epoch),
    horizon: OrgCommitSequence.make(integerTextFromNumeric(state.commitSequence)),
  } satisfies LiveHorizon;
});

export interface InventoryLiveContract {
  readonly mintLiveTicket: (
    actor: InventoryActor,
    request: LiveTicketRequest,
  ) => Effect.Effect<LiveTicket, InventoryError>;
  readonly consumeLiveTicket: (
    actor: InventoryActor,
    query: LiveTicketQuery,
  ) => Effect.Effect<void, InventoryError>;
  readonly readLiveHorizon: (actor: InventoryActor) => Effect.Effect<LiveHorizon, InventoryError>;
}

export class InventoryLive extends Context.Service<InventoryLive, InventoryLiveContract>()(
  "@store/server/InventoryLive",
) {}

export const makeInventoryLive = (db: InventoryDrizzle): InventoryLiveContract => {
  const transact = runTransaction(db);
  return InventoryLive.of({
    mintLiveTicket: Effect.fn("InventoryLive.mintLiveTicket")(function* (actor, request) {
      const now = yield* Clock.currentTimeMillis;
      return yield* transact("read committed", "read write", (tx) =>
        mintLiveTicketInTransaction(tx, actor, request, now),
      );
    }),
    consumeLiveTicket: Effect.fn("InventoryLive.consumeLiveTicket")(function* (actor, query) {
      const now = yield* Clock.currentTimeMillis;
      return yield* transact("read committed", "read write", (tx) =>
        consumeLiveTicketInTransaction(tx, actor, query, now),
      );
    }),
    readLiveHorizon: Effect.fn("InventoryLive.readLiveHorizon")(function* (actor) {
      return yield* transact("repeatable read", "read only", (tx) =>
        readLiveHorizonInTransaction(tx, actor),
      );
    }),
  });
};

export const InventoryLiveUnavailable = Layer.succeed(
  InventoryLive,
  InventoryLive.of({
    mintLiveTicket: () => Effect.fail(inventoryPostgresUnavailable),
    consumeLiveTicket: () => Effect.fail(inventoryPostgresUnavailable),
    readLiveHorizon: () => Effect.fail(inventoryPostgresUnavailable),
  }),
);
