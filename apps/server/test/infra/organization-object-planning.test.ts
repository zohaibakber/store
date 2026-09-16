import { fromDurableObjectState } from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import { SnapshotObjects } from "../../src/inventory/organization-host";
import { organizationInventoryObjectInit } from "../../src/inventory/organization-object";

describe("organization Durable Object planning", () => {
  it("evaluates the outer Effect without touching runtime storage", async () => {
    const state = fromDurableObjectState({ storage: {} });
    const snapshots = SnapshotObjects.of({
      getObject: () => {
        throw new Error("planning touched snapshot storage");
      },
      putObject: () => {
        throw new Error("planning touched snapshot storage");
      },
    });
    const inner = await Effect.runPromise(
      organizationInventoryObjectInit.pipe(
        Effect.provideService(SnapshotObjects, snapshots),
        Effect.provide(Layer.succeed(fromDurableObjectState, state)),
      ),
    );
    expect(Effect.isEffect(inner)).toBe(true);
  });
});
