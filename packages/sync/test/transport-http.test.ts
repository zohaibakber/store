import { describe, expect, it } from "@effect/vitest";
import { OPERATIONAL_SUBSCRIPTION, OrgCommitSequence, SyncEpoch } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import {
  dispositionFor,
  makeSyncTransport,
  SYNC_REQUEST_TIMEOUT_MILLIS,
  SyncTransportOffline,
  SyncTransportUnavailable,
} from "../src/transport";

const pullRequest = {
  epoch: SyncEpoch.make("1"),
  subscription: OPERATIONAL_SUBSCRIPTION,
  afterCommitSequence: OrgCommitSequence.make("0"),
};

const conflictBody = (code: string) =>
  JSON.stringify({ _tag: "Conflict", error: { code, message: "The snapshot is building." } });

const transportWith = (fetch: typeof globalThis.fetch) =>
  makeSyncTransport("https://api.tabaaq.test").pipe(
    Effect.provide(
      FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))),
    ),
  );

describe("sync HTTP transport", () => {
  it.effect("honours Retry-After on a typed protocol error from the authority", () =>
    Effect.gen(function* () {
      const transport = yield* transportWith(async () =>
        Response.json(JSON.parse(conflictBody("SNAPSHOT_UNAVAILABLE")), {
          status: 409,
          headers: { "retry-after": "12" },
        }),
      );
      const failure = yield* Effect.flip(transport.pull(pullRequest));
      expect(failure).toBeInstanceOf(SyncTransportUnavailable);
      expect(dispositionFor(failure)).toEqual({ _tag: "retry", delayMillis: 12_000 });
    }),
  );

  it.effect("keeps a typed protocol error without Retry-After", () =>
    Effect.gen(function* () {
      const transport = yield* transportWith(async () =>
        Response.json(JSON.parse(conflictBody("SNAPSHOT_REQUIRED")), { status: 409 }),
      );
      const failure = yield* Effect.flip(transport.pull(pullRequest));
      expect(failure).toMatchObject({ _tag: "SyncProtocolError", code: "SNAPSHOT_REQUIRED" });
    }),
  );

  it.effect("fails a stalled pull as offline once its deadline passes", () =>
    Effect.gen(function* () {
      const aborted: Array<boolean> = [];
      const transport = yield* transportWith(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              aborted.push(true);
              reject(init.signal?.reason);
            });
          }),
      );
      const pending = yield* Effect.forkChild(Effect.flip(transport.pull(pullRequest)));
      yield* TestClock.adjust(SYNC_REQUEST_TIMEOUT_MILLIS.pull - 1);
      expect(aborted).toEqual([]);
      yield* TestClock.adjust(1);
      const failure = yield* Fiber.join(pending);
      expect(failure).toBeInstanceOf(SyncTransportOffline);
      expect(aborted).toEqual([true]);
    }),
  );
});
