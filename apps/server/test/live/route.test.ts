import * as PgClient from "@effect/sql-pg/PgClient";
import { LIVE_SOCKET_PROTOCOL, liveBearerProtocol } from "@store/contracts";
import { LAST_UNIT_EPOCH } from "@store/contracts/sync/fixtures";
import { inventoryState, replicas } from "@store/db/postgres/schema";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Redacted from "effect/Redacted";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeInventoryLive } from "../../src/inventory/live-horizon";
import { liveSocketHandler, type LiveRouteDependencies } from "../../src/live/route";
import { startAuthorityPostgres, type AuthorityPostgres } from "../inventory/authority-postgres";
import { claimsFor, TEST_ACCESS_TOKEN, testRuntimeContext, verifierFor } from "../lib/app";

const verifyAccessToken = verifierFor(claimsFor("owner", "org-1", Date.now() + 60 * 60_000));

const makeFixture = () => {
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
  return { forwarded, hubs };
};

const socketHeaders = {
  upgrade: "websocket",
  "sec-websocket-protocol": `${LIVE_SOCKET_PROTOCOL}, ${liveBearerProtocol(TEST_ACCESS_TOKEN)}`,
};

describe("live upgrade on Postgres", () => {
  let database: AuthorityPostgres;

  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  const connectOnPostgres = (replicaId: string) => {
    const fixture = makeFixture();
    return Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* PgDrizzle.makeWithDefaults();
        const live = makeInventoryLive(db);
        const response = yield* liveSocketHandler({
          hubs: fixture.hubs,
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
        return { status: response.status, body, forwarded: fixture.forwarded };
      }).pipe(
        Effect.provide(
          PgClient.layer({
            url: Redacted.make(database.connectionString),
            maxConnections: 2,
            applicationName: "tabaaq-live-route-tests",
          }),
        ),
        Effect.provideContext(testRuntimeContext),
        Effect.scoped,
      ),
    );
  };

  beforeAll(async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* PgDrizzle.makeWithDefaults();
        yield* db.insert(inventoryState).values({
          organizationId: "org-1",
          incarnation: "incarnation-test",
          epoch: LAST_UNIT_EPOCH,
          commitSequence: "12",
          retentionFloor: "0",
        });
        yield* db.insert(replicas).values(
          [
            { replicaId: "replica-a", ownerUserId: "user-1" },
            { replicaId: "replica-other", ownerUserId: "user-2" },
          ].map((replica) => ({
            ...replica,
            organizationId: "org-1",
            deviceLabel: replica.replicaId,
            lastClientSequence: "0",
            processedThroughClientSequence: "0",
            registeredAt: 1_700_000_000_000,
            lastSeenAt: 1_700_000_000_000,
          })),
        );
      }).pipe(
        Effect.provide(
          PgClient.layer({
            url: Redacted.make(database.connectionString),
            maxConnections: 1,
            applicationName: "tabaaq-live-route-seed",
          }),
        ),
        Effect.scoped,
      ),
    );
  }, 180_000);

  it("refuses a replica another member owns, so it cannot evict their socket", async () => {
    const outcome = await connectOnPostgres("replica-other");
    expect(outcome.status).toBe(403);
    expect(JSON.parse(outcome.body)).toMatchObject({ error: { code: "REPLICA_OWNED_BY_OTHER" } });
    expect(outcome.forwarded).toEqual([]);
  });
});
