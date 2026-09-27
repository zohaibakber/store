import {
  compareDecimalSequence,
  LIVE_LEASE_LIFETIME_MILLIS,
  LIVE_LONG_POLL_DEFAULT_MILLIS,
  LIVE_LONG_POLL_MAX_MILLIS,
  LIVE_SSE_KEEPALIVE_MILLIS,
  LIVE_SSE_POLL_MILLIS,
  LiveUpgradeQuery,
  OPERATIONAL_SUBSCRIPTION,
  SyncLiveSseEvent,
  SyncLiveWakeHint,
  syncProtocolError,
} from "@store/contracts";
import type { RuntimeContext } from "alchemy";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { InventoryLiveContract } from "./live-tickets";
import type { InventorySyncActor } from "./model";
import {
  toSyncAuthorityError,
  type SyncAuthorityError,
  type SyncLiveUpgradeContract,
} from "./sync-authority";

const clampWaitMs = (waitMs: number | undefined): number => {
  const requested = waitMs ?? LIVE_LONG_POLL_DEFAULT_MILLIS;
  return Math.min(Math.max(requested, 1), LIVE_LONG_POLL_MAX_MILLIS);
};

const wakeHintFromHorizon = (horizon: {
  readonly epoch: SyncLiveWakeHint["epoch"];
  readonly horizon: SyncLiveWakeHint["horizon"];
}): SyncLiveWakeHint => ({
  epoch: horizon.epoch,
  subscription: OPERATIONAL_SUBSCRIPTION,
  horizon: horizon.horizon,
});

const wakeEvent = (hint: SyncLiveWakeHint): SyncLiveSseEvent => ({
  event: "wake",
  id: hint.horizon,
  data: Schema.encodeSync(Schema.fromJsonString(SyncLiveWakeHint))(hint),
});

const pingEvent = (): SyncLiveSseEvent => ({
  event: "ping",
  id: undefined,
  data: "{}",
});

type SseCursor = {
  readonly horizon: SyncLiveWakeHint["horizon"];
  readonly lastSentAt: number;
};

const openLiveSession = (
  live: InventoryLiveContract,
  actor: InventorySyncActor,
  query: LiveUpgradeQuery,
) =>
  query.nonce === undefined
    ? Effect.void
    : toSyncAuthorityError(
        live.consumeLiveTicket(actor, {
          nonce: query.nonce,
          replicaId: query.replicaId,
          subscription: query.subscription,
        }),
      );

const readHorizon = (live: InventoryLiveContract, actor: InventorySyncActor) =>
  toSyncAuthorityError(live.readLiveHorizon(actor));

const longPollSchedule = (deadline: number) =>
  Schedule.spaced(LIVE_SSE_POLL_MILLIS).pipe(
    Schedule.while(({ now }) => now < deadline),
    Schedule.modifyDelay(({ now, duration }) =>
      Effect.succeed(Duration.min(duration, Duration.millis(deadline - now))),
    ),
  );

const longPollResponse = (
  live: InventoryLiveContract,
  actor: InventorySyncActor,
  query: LiveUpgradeQuery,
): Effect.Effect<SyncLiveWakeHint | void, SyncAuthorityError, RuntimeContext> =>
  Effect.gen(function* () {
    yield* openLiveSession(live, actor, query);
    const deadline = (yield* Clock.currentTimeMillis) + clampWaitMs(query.waitMs);
    const afterHorizon = query.afterHorizon ?? "0";

    const pollOnce = Effect.gen(function* () {
      if ((yield* Clock.currentTimeMillis) >= actor.authorizationExpiresAt) {
        return yield* Effect.fail(
          syncProtocolError("TICKET_INVALID", "The authorization lease has expired."),
        );
      }
      const current = yield* readHorizon(live, actor);
      return compareDecimalSequence(current.horizon, afterHorizon) > 0
        ? wakeHintFromHorizon(current)
        : undefined;
    });

    return yield* pollOnce.pipe(
      Effect.repeat({
        schedule: longPollSchedule(deadline),
        until: (hint): boolean => hint !== undefined,
      }),
    );
  });

const sseResponse = (
  live: InventoryLiveContract,
  actor: InventorySyncActor,
  query: LiveUpgradeQuery,
): Effect.Effect<Stream.Stream<SyncLiveSseEvent>, SyncAuthorityError, RuntimeContext> =>
  Effect.gen(function* () {
    yield* openLiveSession(live, actor, query);
    const startedAt = yield* Clock.currentTimeMillis;
    const leaseEndsAt = Math.min(
      startedAt + LIVE_LEASE_LIFETIME_MILLIS,
      actor.authorizationExpiresAt,
    );
    const initial = yield* readHorizon(live, actor);
    const runtime = yield* Effect.context<RuntimeContext>();

    const leaseOpen = Clock.currentTimeMillis.pipe(Effect.map((now) => now < leaseEndsAt));

    const polledEvents = Stream.fromSchedule(Schedule.spaced(LIVE_SSE_POLL_MILLIS)).pipe(
      Stream.takeWhileEffect(() => leaseOpen),
      Stream.mapEffect(() =>
        Effect.all({
          current: readHorizon(live, actor).pipe(Effect.orDie),
          now: Clock.currentTimeMillis,
        }),
      ),
      Stream.mapAccum(
        (): SseCursor => ({ horizon: initial.horizon, lastSentAt: startedAt }),
        (cursor, { current, now }): readonly [SseCursor, ReadonlyArray<SyncLiveSseEvent>] => {
          if (compareDecimalSequence(current.horizon, cursor.horizon) > 0) {
            return [
              { horizon: current.horizon, lastSentAt: now },
              [wakeEvent(wakeHintFromHorizon(current))],
            ];
          }
          if (now - cursor.lastSentAt >= LIVE_SSE_KEEPALIVE_MILLIS) {
            return [{ horizon: cursor.horizon, lastSentAt: now }, [pingEvent()]];
          }
          return [cursor, []];
        },
      ),
    );

    const events = Stream.make(wakeEvent(wakeHintFromHorizon(initial))).pipe(
      Stream.concat(polledEvents),
    );

    return Stream.provideContext(
      Stream.unwrap(leaseOpen.pipe(Effect.map((open) => (open ? events : Stream.empty)))),
      runtime,
    );
  });

export const makePostgresSyncLiveUpgrade = (
  live: InventoryLiveContract,
): SyncLiveUpgradeContract => ({
  handle: (actor, query, preferSse) => {
    if (query.subscription !== OPERATIONAL_SUBSCRIPTION) {
      return Effect.fail(
        syncProtocolError("TICKET_INVALID", "The live subscription is not supported."),
      );
    }
    return preferSse ? sseResponse(live, actor, query) : longPollResponse(live, actor, query);
  },
});
