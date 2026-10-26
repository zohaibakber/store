import { describe, expect, it } from "@effect/vitest";
import { OPERATIONAL_SUBSCRIPTION, OrgCommitSequence } from "@store/contracts";
import { LAST_UNIT_EPOCH, LAST_UNIT_REPLICA_A } from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { TestClock } from "effect/testing";

import { makeSyncTransport, type SyncTransport } from "../src/transport";

const silent: typeof globalThis.fetch = () => new Promise<Response>(() => undefined);

const givesUpAt = (
  call: (transport: SyncTransport["Service"]) => Effect.Effect<unknown, unknown>,
  deadlineMillis: number,
) =>
  Effect.gen(function* () {
    const transport = yield* makeSyncTransport("https://api.example.test");
    const waiting = yield* Effect.forkChild(Effect.flip(call(transport)));
    yield* TestClock.adjust(deadlineMillis - 1);
    expect(waiting.pollUnsafe()).toBeUndefined();
    yield* TestClock.adjust(1);
    expect(yield* Fiber.join(waiting)).toMatchObject({ _tag: "SyncTransportOffline" });
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, silent),
  );

describe("sync transport deadlines", () => {
  it.effect("registerReplica gives up as offline after 15 seconds", () =>
    givesUpAt(
      (transport) =>
        transport.registerReplica({ replicaId: LAST_UNIT_REPLICA_A, schemaVersion: 1 }),
      15_000,
    ),
  );

  it.effect("pull gives up as offline after 30 seconds", () =>
    givesUpAt(
      (transport) =>
        transport.pull({
          epoch: LAST_UNIT_EPOCH,
          subscription: OPERATIONAL_SUBSCRIPTION,
          afterCommitSequence: OrgCommitSequence.make("0"),
        }),
      30_000,
    ),
  );
});
