import { OrganizationId, UserId } from "@store/auth";
import { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { makeHubRevocation, type RevocableHubs } from "../src/hub-revocation";

const runtimeContext = Context.make(RuntimeContext, {
  Type: "test",
  id: "hub-revocation-test",
  env: {},
  get: () => Effect.succeed(undefined),
  set: (id) => Effect.succeed(id),
});

const organizationId = OrganizationId.make("organization-1");
const userId = UserId.make("member");

const hubsRecording = (calls: Array<string>, fail = false): RevocableHubs => ({
  getByName: (name) => ({
    revoke: (user) =>
      Effect.suspend(() => {
        calls.push(`${name}/${user}`);
        return fail ? Effect.fail(new Error("hub unreachable")) : Effect.succeed(1);
      }),
  }),
});

describe("hub revocation", () => {
  it("hands the revoke to the background instead of waiting for the hub", async () => {
    const calls: Array<string> = [];
    const background: Array<Effect.Effect<void, never, RuntimeContext>> = [];
    const revocation = makeHubRevocation(hubsRecording(calls), (effect) =>
      Effect.sync(() => {
        background.push(effect);
      }),
    );
    await Effect.runPromise(
      revocation.revoke(organizationId, userId).pipe(Effect.provideContext(runtimeContext)),
    );
    expect(calls).toEqual([]);
    expect(background).toHaveLength(1);
    await Effect.runPromise(
      Effect.forEach(background, (effect) => effect, { discard: true }).pipe(
        Effect.provideContext(runtimeContext),
      ),
    );
    expect(calls).toEqual(["organization-1/member"]);
  });

  it("swallows a hub failure so the membership change still stands", async () => {
    const calls: Array<string> = [];
    const revocation = makeHubRevocation(hubsRecording(calls, true), (effect) => effect);
    await Effect.runPromise(
      revocation.revoke(organizationId, userId).pipe(Effect.provideContext(runtimeContext)),
    );
    expect(calls).toEqual(["organization-1/member"]);
  });
});
