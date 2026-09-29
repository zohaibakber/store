import * as PgClient from "@effect/sql-pg/PgClient";
import { AuthSession, EmailAddress, OrganizationId, SessionId, UserId } from "@store/auth";
import {
  LIVE_SOCKET_PROTOCOL,
  liveBearerProtocol,
  OrgCommitSequence,
  SyncEpoch,
} from "@store/contracts";
import { LAST_UNIT_EPOCH } from "@store/contracts/sync/fixtures";
import { inventoryState, replicas } from "@store/db/postgres/schema";
import { RuntimeContext } from "alchemy";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildOncePerIsolate, recoverUnexpected, ServerRoutes } from "../../src/http/app";
import { ServerRuntime, type ServerRuntimeContract } from "../../src/http/runtime";
import { makeInventoryLive } from "../../src/inventory/live-horizon";
import { databaseError } from "../../src/inventory/postgres";
import { SyncAuthority } from "../../src/inventory/sync-authority";
import { HUB_ADMISSION_HEADERS } from "../../src/live/hub-core";
import { LiveRoutes, liveSocketHandler, type LiveRouteDependencies } from "../../src/live/route";
import { startAuthorityPostgres, type AuthorityPostgres } from "../inventory/authority-postgres";
import { silentLiveFanout, unusedSyncAuthority } from "../lib/app";
import { countStatements } from "../lib/statement-count";

const GOOD_TOKEN = "header.payload.signature";
const SESSION_EXPIRES_AT = Date.now() + 60 * 60_000;

const runtimeContext = Context.make(RuntimeContext, {
  Type: "test",
  id: "live-route-test",
  env: {},
  get: () => Effect.succeed(undefined),
  set: (id) => Effect.succeed(id),
});

const session = AuthSession.make({
  user: {
    id: UserId.make("user-1"),
    name: "Member",
    email: EmailAddress.make("member@example.com"),
    image: null,
  },
  session: {
    id: SessionId.make("session-1"),
    userId: UserId.make("user-1"),
    activeOrganizationId: OrganizationId.make("org-1"),
    expiresAt: SESSION_EXPIRES_AT,
  },
  organizations: [
    { id: OrganizationId.make("org-1"), name: "Tabaaq", slug: "tabaaq", role: "owner" },
  ],
});

const unused = () => Effect.die("unused");

const serverRuntime: ServerRuntimeContract = {
  electronProtocol: "com.tabaaq.desktop",
  trustedOrigins: [],
  getSession: (headers) =>
    Effect.succeed(headers.get("authorization") === `Bearer ${GOOD_TOKEN}` ? session : null),
  loadWorkspace: unused,
  invoiceAi: Effect.die("unused"),
  productScanAi: Effect.die("unused"),
  limitInvoiceExtraction: unused,
  limitProductScan: unused,
};

type Forwarded = { readonly organizationId: string; readonly headers: Record<string, string> };

const makeFixture = (
  options: {
    readonly readLiveHorizon?: LiveRouteDependencies["readLiveHorizon"];
  } = {},
) => {
  const forwarded: Array<Forwarded> = [];
  const horizonReads: Array<string> = [];
  const hubs: LiveRouteDependencies["hubs"] = {
    getByName: (organizationId) => ({
      fetch: (request) =>
        Effect.sync(() => {
          forwarded.push({ organizationId, headers: { ...request.headers } });
          return HttpServerResponse.empty({
            status: 204,
            headers: { "sec-websocket-protocol": LIVE_SOCKET_PROTOCOL },
          });
        }),
    }),
  };
  const readLiveHorizon: LiveRouteDependencies["readLiveHorizon"] =
    options.readLiveHorizon ??
    ((actor) =>
      Effect.sync(() => {
        horizonReads.push(actor.organizationId);
        return { epoch: SyncEpoch.make("1"), horizon: OrgCommitSequence.make("7") };
      }));
  const serve = async (path: string, init?: RequestInit) => {
    const app = Layer.mergeAll(
      ServerRoutes,
      LiveRoutes({ hubs, getSession: serverRuntime.getSession, readLiveHorizon }),
    ).pipe(
      Layer.provide(Layer.succeed(ServerRuntime, serverRuntime)),
      Layer.provide(Layer.succeed(SyncAuthority, unusedSyncAuthority)),
      Layer.provide(silentLiveFanout),
      Layer.provide(HttpServer.layerServices),
    );
    const serveRequest = await Effect.runPromise(
      buildOncePerIsolate(HttpRouter.toHttpEffect(app), runtimeContext),
    );
    const handler = HttpEffect.toWebHandler(
      recoverUnexpected(serveRequest).pipe(Effect.provideContext(runtimeContext)),
    );
    return handler(new Request(new URL(path, "http://localhost"), init));
  };
  return { serve, forwarded, horizonReads, hubs };
};

const socketHeaders = (token: string | undefined, extra: Record<string, string> = {}) => ({
  upgrade: "websocket",
  "sec-websocket-protocol":
    token === undefined
      ? LIVE_SOCKET_PROTOCOL
      : `${LIVE_SOCKET_PROTOCOL}, ${liveBearerProtocol(token)}`,
  ...extra,
});

describe("GET /api/sync/live", () => {
  it("requires a WebSocket upgrade", async () => {
    const fixture = makeFixture();
    const response = await fixture.serve("/api/sync/live?replicaId=replica-a");
    expect(response.status).toBe(426);
    expect(fixture.forwarded).toEqual([]);
  });

  it("refuses a socket without a bearer subprotocol or with a bad token", async () => {
    const fixture = makeFixture();
    const missing = await fixture.serve("/api/sync/live?replicaId=replica-a", {
      headers: socketHeaders(undefined),
    });
    const wrong = await fixture.serve("/api/sync/live?replicaId=replica-a", {
      headers: socketHeaders("forged.token.value"),
    });
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(fixture.horizonReads).toEqual([]);
    expect(fixture.forwarded).toEqual([]);
  });

  it("needs the replica id before reading the horizon", async () => {
    const fixture = makeFixture();
    const response = await fixture.serve("/api/sync/live", { headers: socketHeaders(GOOD_TOKEN) });
    expect(response.status).toBe(400);
    expect(fixture.horizonReads).toEqual([]);
  });

  it("forwards the socket to the organization's hub with the verified identity", async () => {
    const fixture = makeFixture();
    const response = await fixture.serve("/api/sync/live?replicaId=replica-a&maxBytes=262144", {
      headers: socketHeaders(GOOD_TOKEN, { [HUB_ADMISSION_HEADERS.userId]: "someone-else" }),
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("sec-websocket-protocol")).toBe(LIVE_SOCKET_PROTOCOL);
    expect(fixture.horizonReads).toEqual(["org-1"]);
    expect(fixture.forwarded).toHaveLength(1);
    const [forwarded] = fixture.forwarded;
    expect(forwarded?.organizationId).toBe("org-1");
    expect(forwarded?.headers).toMatchObject({
      [HUB_ADMISSION_HEADERS.replicaId]: "replica-a",
      [HUB_ADMISSION_HEADERS.userId]: "user-1",
      [HUB_ADMISSION_HEADERS.expiresAt]: String(SESSION_EXPIRES_AT),
      [HUB_ADMISSION_HEADERS.maxBytes]: "262144",
      [HUB_ADMISSION_HEADERS.epoch]: "1",
      [HUB_ADMISSION_HEADERS.horizon]: "7",
    });
  });

  it("answers 503 when the sync store fails", async () => {
    const fixture = makeFixture({
      readLiveHorizon: () => Effect.fail(databaseError(new Error("connection refused"))),
    });
    const response = await fixture.serve("/api/sync/live?replicaId=replica-a", {
      headers: socketHeaders(GOOD_TOKEN),
    });
    expect(response.status).toBe(503);
    expect(fixture.forwarded).toEqual([]);
  });
});

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
        const counted = yield* countStatements(
          liveSocketHandler({
            hubs: fixture.hubs,
            getSession: serverRuntime.getSession,
            readLiveHorizon: live.readLiveHorizon,
          }).pipe(
            Effect.provideService(
              HttpServerRequest.HttpServerRequest,
              HttpServerRequest.fromWeb(
                new Request(`http://localhost/api/sync/live?replicaId=${replicaId}`, {
                  headers: socketHeaders(GOOD_TOKEN),
                }),
              ),
            ),
          ),
        );
        const body = yield* Effect.promise(() => HttpServerResponse.toWeb(counted.result).text());
        return { ...counted, body, forwarded: fixture.forwarded };
      }).pipe(
        Effect.provide(
          PgClient.layer({
            url: Redacted.make(database.connectionString),
            maxConnections: 2,
            applicationName: "tabaaq-live-route-tests",
          }),
        ),
        Effect.provideContext(runtimeContext),
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

  it("reads the horizon and the replica owner in one statement per connect", async () => {
    const outcome = await connectOnPostgres("replica-a");
    expect(outcome.result.status).toBe(204);
    expect(outcome.roundTrips).toBe(1);
    expect(outcome.forwarded[0]?.headers).toMatchObject({
      [HUB_ADMISSION_HEADERS.epoch]: LAST_UNIT_EPOCH,
      [HUB_ADMISSION_HEADERS.horizon]: "12",
    });
  });

  it("refuses a replica another member owns, so it cannot evict their socket", async () => {
    const outcome = await connectOnPostgres("replica-other");
    expect(outcome.result.status).toBe(403);
    expect(JSON.parse(outcome.body)).toMatchObject({ error: { code: "REPLICA_OWNED_BY_OTHER" } });
    expect(outcome.roundTrips).toBe(1);
    expect(outcome.forwarded).toEqual([]);
  });

  it("refuses a replica that was never registered", async () => {
    const outcome = await connectOnPostgres("replica-unregistered");
    expect(outcome.result.status).toBe(409);
    expect(JSON.parse(outcome.body)).toMatchObject({ error: { code: "REPLICA_UNKNOWN" } });
    expect(outcome.forwarded).toEqual([]);
  });
});
