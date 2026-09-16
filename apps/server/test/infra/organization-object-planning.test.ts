import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { SnapshotObjects } from "../../src/inventory/organization-host";
import { organizationInventoryObjectInit } from "../../src/inventory/organization-object";

const planningTouched = (member: string): never => {
  throw new Error(`planning touched ${member}`);
};

const planningState = Cloudflare.DurableObjectState.of({
  get id() {
    return planningTouched("id");
  },
  get storage() {
    return planningTouched("storage");
  },
  get container() {
    return planningTouched("container");
  },
  get raw() {
    return planningTouched("raw");
  },
  waitUntil: () => planningTouched("waitUntil"),
  blockConcurrencyWhile: () => planningTouched("blockConcurrencyWhile"),
  acceptWebSocket: () => planningTouched("acceptWebSocket"),
  getWebSockets: () => planningTouched("getWebSockets"),
  setWebSocketAutoResponse: () => planningTouched("setWebSocketAutoResponse"),
  getWebSocketAutoResponse: () => planningTouched("getWebSocketAutoResponse"),
  getWebSocketAutoResponseTimestamp: () => planningTouched("getWebSocketAutoResponseTimestamp"),
  setHibernatableWebSocketEventTimeout: () =>
    planningTouched("setHibernatableWebSocketEventTimeout"),
  getHibernatableWebSocketEventTimeout: () =>
    planningTouched("getHibernatableWebSocketEventTimeout"),
  getTags: () => planningTouched("getTags"),
  abort: () => planningTouched("abort"),
});

const planningSnapshots = SnapshotObjects.of({
  getObject: () => planningTouched("snapshot storage"),
  putObject: () => planningTouched("snapshot storage"),
});

describe("organization Durable Object planning", () => {
  it("evaluates the outer Effect without touching runtime state", async () => {
    const inner = await Effect.runPromise(
      organizationInventoryObjectInit.pipe(
        Effect.provideService(SnapshotObjects, planningSnapshots),
        Effect.provideService(Cloudflare.DurableObjectState, planningState),
      ),
    );

    expect(Effect.isEffect(inner)).toBe(true);
  });
});
