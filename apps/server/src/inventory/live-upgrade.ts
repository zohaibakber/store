import {
  compareDecimalSequence,
  LIVE_LEASE_LIFETIME_MILLIS,
  LIVE_LONG_POLL_DEFAULT_MILLIS,
  LIVE_LONG_POLL_MAX_MILLIS,
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

const openLiveSession = (
  live: InventoryLiveContract,
  actor: InventorySyncActor,
  query: LiveUpgradeQuery,
) =>
  toSyncAuthorityError(
    live.consumeLiveTicket(actor, {
      nonce: query.nonce,
      replicaId: query.replicaId,
      subscription: query.subscription,
    }),
  );

const readHorizon = (live: InventoryLiveContract, actor: InventorySyncActor) =>
  toSyncAuthorityError(live.readLiveHorizon(actor));

const longPollResponse = (
  live: InventoryLiveContract,
  actor: InventorySyncActor,
  query: LiveUpgradeQuery,
): Effect.Effect<SyncLiveWakeHint | void, SyncAuthorityError, RuntimeContext> =>
  Effect.gen(function* () {
    yield* openLiveSession(live, actor, query);
    const waitMs = clampWaitMs(query.waitMs);
    const deadline = (yield* Clock.currentTimeMillis) + waitMs;
    let last = query.afterHorizon ?? "0";

    while ((yield* Clock.currentTimeMillis) < deadline) {
      const now = yield* Clock.currentTimeMillis;
      if (now >= actor.authorizationExpiresAt) {
        return yield* Effect.fail(
          syncProtocolError("TICKET_INVALID", "The authorization lease has expired."),
        );
      }
      const current = yield* readHorizon(live, actor);
      if (compareDecimalSequence(current.horizon, last) > 0) {
        return wakeHintFromHorizon(current);
      }
      const remaining = deadline - now;
      if (remaining <= 0) break;
      yield* Effect.sleep(Duration.millis(Math.min(LIVE_SSE_POLL_MILLIS, remaining)));
    }

    return undefined;
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
    const lastHorizon = query.afterHorizon ?? initial.horizon;
    const runtime = yield* Effect.context<RuntimeContext>();

    type SseState = {
      readonly lastHorizon: typeof initial.horizon;
      readonly sentInitial: boolean;
    };

    return Stream.provideContext(
      Stream.unfold({ lastHorizon, sentInitial: false } satisfies SseState, (state: SseState) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          if (now >= leaseEndsAt) return undefined;

          if (!state.sentInitial) {
            return [
              wakeEvent(wakeHintFromHorizon(initial)),
              { lastHorizon: initial.horizon, sentInitial: true } satisfies SseState,
            ] as const;
          }

          yield* Effect.sleep(Duration.millis(LIVE_SSE_POLL_MILLIS));
          const pollNow = yield* Clock.currentTimeMillis;
          if (pollNow >= leaseEndsAt) return undefined;

          const current = yield* readHorizon(live, actor).pipe(Effect.orDie);
          if (compareDecimalSequence(current.horizon, state.lastHorizon) > 0) {
            return [
              wakeEvent(wakeHintFromHorizon(current)),
              { lastHorizon: current.horizon, sentInitial: true } satisfies SseState,
            ] as const;
          }

          return [
            pingEvent(),
            { lastHorizon: state.lastHorizon, sentInitial: true } satisfies SseState,
          ] as const;
        }),
      ),
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
