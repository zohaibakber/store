import type * as Cf from "@cloudflare/workers-types";
import * as Cloudflare from "alchemy/Cloudflare";
import { fromDurableObjectState } from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { SnapshotObjects } from "../../src/inventory/organization-host";
import { organizationInventoryObjectInit } from "../../src/inventory/organization-object";

describe("organization Durable Object planning", () => {
  it("evaluates the outer Effect without touching runtime storage", async () => {
    const planningState = fromDurableObjectState(
      // SAFETY: planning evaluates binding discovery only; storage is not read here
      { storage: {} } as Cf.DurableObjectState,
    );
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
        Effect.provideService(Cloudflare.DurableObjectState, planningState),
      ),
    );
    expect(Effect.isEffect(inner)).toBe(true);
  });
});
