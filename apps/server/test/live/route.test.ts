import { LIVE_SOCKET_PROTOCOL, liveBearerProtocol } from "@store/contracts";
import { LAST_UNIT_EPOCH } from "@store/contracts/sync/fixtures";
import { authorityState, replicas } from "@store/db/authority.schema";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { describe, expect, it } from "vite-plus/test";

import { makeInventoryLive } from "../../src/inventory/live-horizon";
import { liveSocketHandler, type LiveRouteDependencies } from "../../src/live/route";
import { makeTestAuthorities } from "../authority/harness";
import { claimsFor, TEST_ACCESS_TOKEN, testRuntimeContext, verifierFor } from "../lib/app";

const verifyAccessToken = verifierFor(claimsFor("owner", "org-1", Date.now() + 60 * 60_000));

const socketHeaders = {
  upgrade: "websocket",
  "sec-websocket-protocol": `${LIVE_SOCKET_PROTOCOL}, ${liveBearerProtocol(TEST_ACCESS_TOKEN)}`,
};

const connect = (replicaId: string) => {
  const forwarded: Array<string> = [];
  const hubs: LiveRouteDependencies["hubs"] = {
    getByName: (organizationId) => ({
      fetch: () =>
        Effect.sync(() => {
          forwarded.push(organizationId);
          return HttpServerResponse.empty({
            status: 204,
            headers: { "sec-websocket-protocol": LIVE_SOCKET_PROTOCOL },
          });
        }),
    }),
  };
  return Effect.runPromise(
    Effect.gen(function* () {
      const authorities = makeTestAuthorities();
      const { db } = yield* authorities.open("org-1");
      yield* db.insert(authorityState).values({
        id: 1,
        organizationId: "org-1",
        incarnation: "incarnation-test",
        epoch: LAST_UNIT_EPOCH,
        commitSequence: 12,
        retentionFloor: 0,
        createdAt: 1_700_000_000_000,
      });
      for (const replica of [
        { replicaId: "replica-a", ownerUserId: "user-1" },
        { replicaId: "replica-other", ownerUserId: "user-2" },
      ]) {
        yield* db.insert(replicas).values({
          ...replica,
          deviceLabel: replica.replicaId,
          lastClientSequence: 0,
          processedThroughClientSequence: 0,
          registeredAt: 1_700_000_000_000,
          lastSeenAt: 1_700_000_000_000,
        });
      }
      const live = makeInventoryLive(authorities);
      const response = yield* liveSocketHandler({
        hubs,
        verifyAccessToken,
        readLiveHorizon: live.readLiveHorizon,
      }).pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(
            new Request(`http://localhost/api/sync/live?replicaId=${replicaId}`, {
              headers: socketHeaders,
            }),
          ),
        ),
      );
      const body = yield* Effect.promise(() => HttpServerResponse.toWeb(response).text());
      return { status: response.status, body, forwarded };
    }).pipe(Effect.orDie, Effect.provideContext(testRuntimeContext), Effect.scoped),
  );
};

describe("live upgrade on the organization authority", () => {
  it("refuses a replica another member owns, so it cannot evict their socket", async () => {
    const outcome = await connect("replica-other");
    expect(outcome.status).toBe(403);
    expect(JSON.parse(outcome.body)).toMatchObject({ error: { code: "REPLICA_OWNED_BY_OTHER" } });
    expect(outcome.forwarded).toEqual([]);
  });

  it("forwards the owner's replica to the hub", async () => {
    const outcome = await connect("replica-a");
    expect(outcome.forwarded).toEqual(["org-1"]);
  });
});
