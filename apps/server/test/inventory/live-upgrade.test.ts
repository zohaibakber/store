import { it } from "@effect/vitest";
import {
  LIVE_SSE_KEEPALIVE_MILLIS,
  LIVE_SSE_POLL_MILLIS,
  LiveUpgradeQuery,
  OrgCommitSequence,
  SyncEpoch,
  SyncProtocolError,
} from "@store/contracts";
import { RuntimeContext } from "alchemy";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import type { InventoryLiveContract } from "../../src/inventory/live-tickets";
import { makePostgresSyncLiveUpgrade } from "../../src/inventory/live-upgrade";

const runtimeContext = {
  Type: "test",
  id: "live-upgrade-test",
  env: {},
  get: () => Effect.succeed(undefined),
  set: (id: string) => Effect.succeed(id),
};

const liveWithHorizons = (horizons: ReadonlyArray<string>) => {
  const reads: Array<number> = [];
  const consumed: Array<string> = [];
  const live: InventoryLiveContract = {
    mintLiveTicket: () => Effect.die("unused"),
    consumeLiveTicket: (_actor, ticket) =>
      Effect.sync(() => {
        consumed.push(ticket.nonce);
      }),
    readLiveHorizon: () =>
      Effect.sync(() => {
        const horizon = horizons[Math.min(reads.length, horizons.length - 1)] ?? "0";
        reads.push(reads.length);
        return { epoch: SyncEpoch.make("1"), horizon: OrgCommitSequence.make(horizon) };
      }),
  };
  return { live, reads, consumed };
};

const query = (fields: {
  readonly afterHorizon?: string;
  readonly waitMs?: string;
  readonly nonce?: string;
}) =>
  Schema.decodeUnknownSync(LiveUpgradeQuery)({
    replicaId: "replica-a",
    subscription: "operational",
    ...fields,
  });

const actor = (authorizationExpiresAt: number) => ({
  organizationId: "org-1",
  userId: "user-1",
  authorizationExpiresAt,
});

it.effect("long poll answers the first horizon past the cursor", () =>
  Effect.gen(function* () {
    const { live, reads } = liveWithHorizons(["4", "4", "5"]);
    const fiber = yield* makePostgresSyncLiveUpgrade(live)
      .handle(actor(3_600_000), query({ afterHorizon: "4", waitMs: "10000" }), false)
      .pipe(Effect.provideService(RuntimeContext, runtimeContext), Effect.forkChild);
    yield* TestClock.adjust(LIVE_SSE_POLL_MILLIS * 2);
    const result = yield* Fiber.join(fiber);
    expect(result).toEqual({ epoch: "1", subscription: "operational", horizon: "5" });
    expect(reads).toHaveLength(3);
  }),
);

it.effect("long poll answers no content once the wait deadline passes", () =>
  Effect.gen(function* () {
    const { live, reads } = liveWithHorizons(["4"]);
    const fiber = yield* makePostgresSyncLiveUpgrade(live)
      .handle(actor(3_600_000), query({ afterHorizon: "4", waitMs: "4000" }), false)
      .pipe(Effect.provideService(RuntimeContext, runtimeContext), Effect.forkChild);
    yield* TestClock.adjust(4_000);
    const result = yield* Fiber.join(fiber);
    expect(result).toBeUndefined();
    expect(reads).toHaveLength(4);
  }),
);

it.effect("long poll rejects a request whose authorization lease has expired", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(10_000);
    const { live } = liveWithHorizons(["4"]);
    const exit = yield* makePostgresSyncLiveUpgrade(live)
      .handle(actor(5_000), query({ afterHorizon: "4" }), false)
      .pipe(Effect.provideService(RuntimeContext, runtimeContext), Effect.exit);
    expect(exit).toStrictEqual(
      Exit.fail(
        SyncProtocolError.make({
          code: "TICKET_INVALID",
          message: "The authorization lease has expired.",
        }),
      ),
    );
  }),
);

it.effect("a bearer-only long poll opens without a ticket; a ticketed one consumes it", () =>
  Effect.gen(function* () {
    const { live, consumed } = liveWithHorizons(["5"]);
    const upgrade = makePostgresSyncLiveUpgrade(live);
    const bearerOnly = yield* upgrade
      .handle(actor(3_600_000), query({ afterHorizon: "4" }), false)
      .pipe(Effect.provideService(RuntimeContext, runtimeContext));
    const nonce = "ab".repeat(32);
    const ticketed = yield* upgrade
      .handle(actor(3_600_000), query({ afterHorizon: "4", nonce }), false)
      .pipe(Effect.provideService(RuntimeContext, runtimeContext));
    expect(bearerOnly).toEqual({ epoch: "1", subscription: "operational", horizon: "5" });
    expect(ticketed).toEqual(bearerOnly);
    expect(consumed).toEqual([nonce]);
  }),
);

it.effect(
  "SSE sends the current horizon, stays silent while idle, pings on keepalive, wakes on advance",
  () =>
    Effect.gen(function* () {
      const pollsBeforeKeepalive = Math.ceil(LIVE_SSE_KEEPALIVE_MILLIS / LIVE_SSE_POLL_MILLIS);
      const { live } = liveWithHorizons([
        ...Array.from({ length: pollsBeforeKeepalive + 1 }, () => "7"),
        "8",
      ]);
      const leaseMillis = LIVE_SSE_POLL_MILLIS * (pollsBeforeKeepalive + 1) + 1;
      const response = yield* makePostgresSyncLiveUpgrade(live)
        .handle(actor(leaseMillis), query({}), true)
        .pipe(Effect.provideService(RuntimeContext, runtimeContext));
      if (response === undefined || !Stream.isStream(response)) {
        return yield* Effect.die("expected an SSE stream");
      }
      const fiber = yield* response.pipe(Stream.runCollect, Effect.forkChild);
      yield* TestClock.adjust(leaseMillis + LIVE_SSE_POLL_MILLIS * 2);
      const events = yield* Fiber.join(fiber);
      expect(events.map((event) => [event.event, event.id])).toEqual([
        ["wake", "7"],
        ["ping", undefined],
        ["wake", "8"],
      ]);
    }),
);
