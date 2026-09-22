import {
  LIVE_TICKET_LIFETIME_MILLIS,
  LiveTicket,
  LiveTicketNonce,
  LiveTicketRequest,
  OrgCommitSequence,
  SyncEpoch,
  SyncProtocolError,
} from "@store/contracts";
import { decodeOrganizationId } from "@store/contracts/ids";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import { consumedTickets, inventoryState, replicas } from "@store/db/postgres/schema";
import { and, eq } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { InventoryDatabaseError } from "./errors";
import type { InventoryActor } from "./model";
import {
  databaseError,
  integerTextFromNumeric,
  inventoryPostgresUnavailable,
  protocol,
  requireReady,
  runTransaction,
  type InventoryDrizzle,
  type InventoryTransaction,
} from "./postgres";

const secureRandomHex = (byteCount: number): string =>
  Encoding.encodeHex(crypto.getRandomValues(new Uint8Array(byteCount)));

export type LiveHorizon = {
  readonly epoch: SyncEpoch;
  readonly horizon: OrgCommitSequence;
};

export const mintLiveTicketInTransaction = (
  tx: InventoryTransaction,
  actor: InventoryActor,
  request: LiveTicketRequest,
  now: number,
): Effect.Effect<LiveTicket, SyncProtocolError | InventoryDatabaseError> =>
  Effect.gen(function* () {
    const [state] = yield* tx
      .select()
      .from(inventoryState)
      .where(eq(inventoryState.organizationId, actor.organizationId))
      .limit(1)
      .pipe(Effect.mapError((cause) => databaseError(cause, "Inventory live ticket failed.")));
    yield* requireReady(state);

    const [replica] = yield* tx
      .select()
      .from(replicas)
      .where(
        and(
          eq(replicas.organizationId, actor.organizationId),
          eq(replicas.replicaId, request.replicaId),
        ),
      )
      .limit(1)
      .pipe(Effect.mapError((cause) => databaseError(cause, "Inventory live ticket failed.")));
    if (!replica) {
      return yield* protocol("TICKET_INVALID", "The replica is not registered.");
    }
    if (replica.ownerUserId !== actor.userId) {
      return yield* protocol("REPLICA_OWNED_BY_OTHER", "This replica belongs to another user.");
    }

    const nonce = Schema.decodeUnknownSync(LiveTicketNonce)(secureRandomHex(32));
    const nonceHash = canonicalPayloadHash(nonce);
    const expiresAt = now + LIVE_TICKET_LIFETIME_MILLIS;
    const inserted = yield* tx
      .insert(consumedTickets)
      .values({
        organizationId: actor.organizationId,
        nonceHash,
        expiresAt,
      })
      .onConflictDoNothing({
        target: [consumedTickets.organizationId, consumedTickets.nonceHash],
      })
      .returning()
      .pipe(Effect.mapError((cause) => databaseError(cause, "Inventory live ticket failed.")));
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

export const consumeLiveTicketInTransaction = (
  tx: InventoryTransaction,
  actor: InventoryActor,
  query: { readonly nonce: string; readonly replicaId: string; readonly subscription: string },
  now: number,
): Effect.Effect<void, SyncProtocolError | InventoryDatabaseError> =>
  Effect.gen(function* () {
    const [state] = yield* tx
      .select()
      .from(inventoryState)
      .where(eq(inventoryState.organizationId, actor.organizationId))
      .limit(1)
      .pipe(Effect.mapError((cause) => databaseError(cause, "Inventory live ticket failed.")));
    yield* requireReady(state);

    const [replica] = yield* tx
      .select()
      .from(replicas)
      .where(
        and(
          eq(replicas.organizationId, actor.organizationId),
          eq(replicas.replicaId, query.replicaId),
        ),
      )
      .limit(1)
      .pipe(Effect.mapError((cause) => databaseError(cause, "Inventory live ticket failed.")));
    if (!replica) {
      return yield* protocol("TICKET_INVALID", "The replica is not registered.");
    }
    if (replica.ownerUserId !== actor.userId) {
      return yield* protocol("REPLICA_OWNED_BY_OTHER", "This replica belongs to another user.");
    }

    const nonceHash = canonicalPayloadHash(query.nonce);
    const [row] = yield* tx
      .select()
      .from(consumedTickets)
      .where(
        and(
          eq(consumedTickets.organizationId, actor.organizationId),
          eq(consumedTickets.nonceHash, nonceHash),
        ),
      )
      .limit(1)
      .pipe(Effect.mapError((cause) => databaseError(cause, "Inventory live ticket failed.")));
    if (!row || row.expiresAt <= now) {
      return yield* protocol("TICKET_INVALID", "The live ticket is invalid or expired.");
    }

    yield* tx
      .delete(consumedTickets)
      .where(
        and(
          eq(consumedTickets.organizationId, actor.organizationId),
          eq(consumedTickets.nonceHash, nonceHash),
        ),
      )
      .pipe(Effect.mapError((cause) => databaseError(cause, "Inventory live ticket failed.")));
  });

export const readLiveHorizonInTransaction = (
  tx: InventoryTransaction,
  actor: InventoryActor,
): Effect.Effect<LiveHorizon, SyncProtocolError | InventoryDatabaseError> =>
  Effect.gen(function* () {
    const [state] = yield* tx
      .select()
      .from(inventoryState)
      .where(eq(inventoryState.organizationId, actor.organizationId))
      .limit(1)
      .pipe(Effect.mapError((cause) => databaseError(cause, "Inventory live ticket failed.")));
    yield* requireReady(state);
    if (!state) {
      return yield* protocol("EPOCH_MISMATCH", "This organization inventory is not ready.");
    }
    return {
      epoch: SyncEpoch.make(state.epoch),
      horizon: OrgCommitSequence.make(integerTextFromNumeric(state.commitSequence)),
    };
  });

export type InventoryLiveError = SyncProtocolError | InventoryDatabaseError;

export interface InventoryLiveContract {
  readonly mintLiveTicket: (
    actor: InventoryActor,
    request: LiveTicketRequest,
  ) => Effect.Effect<LiveTicket, InventoryLiveError>;
  readonly consumeLiveTicket: (
    actor: InventoryActor,
    query: { readonly nonce: string; readonly replicaId: string; readonly subscription: string },
  ) => Effect.Effect<void, InventoryLiveError>;
  readonly readLiveHorizon: (
    actor: InventoryActor,
  ) => Effect.Effect<LiveHorizon, InventoryLiveError>;
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
