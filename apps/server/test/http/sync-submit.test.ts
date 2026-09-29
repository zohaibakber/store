import * as PgClient from "@effect/sql-pg/PgClient";
import { AuthSession, EmailAddress, OrganizationId, SessionId, UserId } from "@store/auth";
import { OrgCommitSequence, type SyncCommandEnvelope } from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  LAST_UNIT_REPLICA_B,
  lastUnitBuyerAEnvelope,
  lastUnitBuyerBEnvelope,
} from "@store/contracts/sync/fixtures";
import { batches, categories, inventoryState, products, replicas } from "@store/db/postgres/schema";
import { RuntimeContext } from "alchemy";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildOncePerIsolate, recoverUnexpected, ServerRoutes } from "../../src/http/app";
import { ServerRuntime, type ServerRuntimeContract } from "../../src/http/runtime";
import {
  makeInventoryCommands,
  MAX_SUBMIT_BODY_BYTES,
  SyncRequestMalformed,
} from "../../src/inventory/commands";
import type { CommitFanout, InventoryActor } from "../../src/inventory/model";
import {
  makeInventorySyncAuthority,
  SyncAuthority,
  type SyncAuthorityContract,
} from "../../src/inventory/sync-authority";
import { LiveFanout, type LiveFanoutContract } from "../../src/live/fanout";
import { startAuthorityPostgres, type AuthorityPostgres } from "../inventory/authority-postgres";
import { unusedSyncAuthority } from "../lib/app";
import { countStatements } from "../lib/statement-count";

const USER_ID = "user-1";

const runtimeContext = Context.make(RuntimeContext, {
  Type: "test",
  id: "sync-submit-test",
  env: {},
  get: () => Effect.succeed(undefined),
  set: (id) => Effect.succeed(id),
});

const session = AuthSession.make({
  user: {
    id: UserId.make(USER_ID),
    name: "Member",
    email: EmailAddress.make("member@example.com"),
    image: null,
  },
  session: {
    id: SessionId.make("session-1"),
    userId: UserId.make(USER_ID),
    activeOrganizationId: OrganizationId.make(LAST_UNIT_ORGANIZATION_ID),
    expiresAt: Date.now() + 60 * 60_000,
  },
  organizations: [
    {
      id: OrganizationId.make(LAST_UNIT_ORGANIZATION_ID),
      name: "Tabaaq",
      slug: "tabaaq",
      role: "owner",
    },
  ],
});

const unused = () => Effect.die("unused");

const serverRuntime: ServerRuntimeContract = {
  electronProtocol: "com.tabaaq.desktop",
  trustedOrigins: [],
  getSession: () => Effect.succeed(session),
  loadWorkspace: unused,
  invoiceAi: Effect.die("unused"),
  productScanAi: Effect.die("unused"),
  limitInvoiceExtraction: unused,
  limitProductScan: unused,
};

type WebHandler = (request: Request) => Promise<Response>;

const serverFor = async (authority: SyncAuthorityContract) => {
  const published: Array<{ readonly organizationId: string; readonly fanout: CommitFanout }> = [];
  const fanout: LiveFanoutContract = {
    publish: (organizationId, value) =>
      Effect.sync(() => {
        published.push({ organizationId, fanout: value });
      }),
  };
  const app = ServerRoutes.pipe(
    Layer.provide(Layer.succeed(ServerRuntime, serverRuntime)),
    Layer.provide(Layer.succeed(SyncAuthority, authority)),
    Layer.provide(Layer.succeed(LiveFanout, fanout)),
    Layer.provide(HttpServer.layerServices),
  );
  const serveRequest = await Effect.runPromise(
    buildOncePerIsolate(HttpRouter.toHttpEffect(app), runtimeContext),
  );
  const handler: WebHandler = HttpEffect.toWebHandler(
    recoverUnexpected(serveRequest).pipe(Effect.provideContext(runtimeContext)),
  );
  return { handler, published };
};

const commandRequest = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/sync/commands", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token", ...headers },
    body,
  });

const snapshotOf = async (response: Response) => ({
  status: response.status,
  contentType: response.headers.get("content-type"),
  body: await response.text(),
});

const recordingAuthority = () => {
  const bodies: Array<string> = [];
  const authority: SyncAuthorityContract = {
    ...unusedSyncAuthority,
    submitCommand: (_actor, bodyText) =>
      Effect.sync(() => {
        bodies.push(bodyText);
      }).pipe(Effect.andThen(Effect.fail(SyncRequestMalformed.make({ message: "unused" })))),
  };
  return { authority, bodies };
};

describe("POST /api/sync/commands without Postgres", () => {
  it("refuses an oversized body before it reaches the authority", async () => {
    const recorder = recordingAuthority();
    const { handler } = await serverFor(recorder.authority);
    const declared = await handler(
      commandRequest("{}", { "content-length": String(MAX_SUBMIT_BODY_BYTES + 1) }),
    );
    const streamed = await handler(commandRequest(`"${"x".repeat(MAX_SUBMIT_BODY_BYTES)}"`));
    expect(declared.status).toBe(413);
    expect(await declared.json()).toMatchObject({ error: { code: "COMMAND_TOO_LARGE" } });
    expect(streamed.status).toBe(413);
    expect(recorder.bodies).toEqual([]);
  });

  it("hands the authority the body text exactly as it arrived", async () => {
    const recorder = recordingAuthority();
    const { handler } = await serverFor(recorder.authority);
    const text = ` ${JSON.stringify(lastUnitBuyerAEnvelope)}\n`;
    const response = await handler(commandRequest(text));
    expect(response.status).toBe(400);
    expect(recorder.bodies).toEqual([text]);
  });
});

describe("POST /api/sync/commands on Postgres", () => {
  let database: AuthorityPostgres;

  const layer = () =>
    PgClient.layer({
      url: Redacted.make(database.connectionString),
      maxConnections: 4,
      applicationName: "tabaaq-sync-submit-tests",
    });

  const seed = (organizationId: string) =>
    Effect.gen(function* () {
      const db = yield* PgDrizzle.makeWithDefaults();
      const occurredAt = 1_700_000_000_000;
      const managed = {
        organizationId,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        createdByUserId: USER_ID,
        updatedByUserId: USER_ID,
        deviceId: LAST_UNIT_REPLICA_A,
        rowVersion: 1,
      };
      yield* db.insert(inventoryState).values({
        organizationId,
        incarnation: "incarnation-test",
        epoch: LAST_UNIT_EPOCH,
        commitSequence: "0",
        retentionFloor: "0",
      });
      yield* db.insert(categories).values({
        ...managed,
        id: "general",
        name: "General",
        tracksPacks: true,
        operationId: "seed-category",
      });
      yield* db.insert(products).values({
        ...managed,
        id: LAST_UNIT_PRODUCT_ID,
        name: "Last unit",
        categoryId: "general",
        aisle: null,
        composition: null,
        strength: null,
        unitsPerPack: 1,
        purchasePrice: 50,
        retailPrice: 100,
        unitPrice: 100,
        visible: true,
        deletedAt: null,
        operationId: "seed-product",
      });
      yield* db.insert(batches).values({
        ...managed,
        id: LAST_UNIT_BATCH_ID,
        productId: LAST_UNIT_PRODUCT_ID,
        batchNumber: "B-1",
        expiresAt: null,
        packQuantity: 0,
        unitQuantity: 5,
        deletedAt: null,
        operationId: "seed-batch",
      });
      for (const replicaId of [LAST_UNIT_REPLICA_A, LAST_UNIT_REPLICA_B]) {
        yield* db.insert(replicas).values({
          organizationId,
          replicaId,
          ownerUserId: USER_ID,
          deviceLabel: replicaId,
          lastClientSequence: "0",
          processedThroughClientSequence: "0",
          registeredAt: occurredAt,
          lastSeenAt: occurredAt,
        });
      }
      return makeInventoryCommands(db);
    });

  const onPostgres = <A, E>(
    organizationId: string,
    use: (context: {
      readonly commands: ReturnType<typeof makeInventoryCommands>;
      readonly handler: WebHandler;
      readonly published: ReadonlyArray<{ readonly fanout: CommitFanout }>;
    }) => Effect.Effect<A, E>,
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const commands = yield* seed(organizationId);
        const snapshots = {
          acquireSnapshot: unused,
          readSnapshotPartEncoded: unused,
        };
        const server = yield* Effect.promise(() =>
          serverFor(makeInventorySyncAuthority({ commands, snapshots })),
        );
        return yield* use({ commands, handler: server.handler, published: server.published });
      }).pipe(Effect.provide(layer()), Effect.scoped),
    );

  const send = (handler: WebHandler, body: BodyInit) =>
    Effect.promise(async () => snapshotOf(await handler(commandRequest(body))));

  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  it("commits a typed envelope and publishes its group", async () => {
    const outcome = await onPostgres(LAST_UNIT_ORGANIZATION_ID, ({ handler, published }) =>
      Effect.gen(function* () {
        const accepted = yield* send(
          handler,
          JSON.stringify({
            ...lastUnitBuyerAEnvelope,
            afterCommitSequence: OrgCommitSequence.make("0"),
          }),
        );
        const replayed = yield* send(
          handler,
          JSON.stringify({
            ...lastUnitBuyerAEnvelope,
            afterCommitSequence: OrgCommitSequence.make("1"),
          }),
        );
        return { accepted, replayed, published: [...published] };
      }),
    );
    expect(outcome.accepted.status).toBe(200);
    expect(outcome.accepted.contentType).toContain("application/json");
    const receipt = JSON.parse(outcome.accepted.body);
    expect(receipt).toMatchObject({
      operationId: lastUnitBuyerAEnvelope.operationId,
      decision: "accepted",
      commitSequence: "1",
    });
    expect(receipt.page.transactions).toHaveLength(1);
    expect(outcome.replayed.status).toBe(200);
    expect(JSON.parse(outcome.replayed.body)).toMatchObject({ decision: "accepted" });
    expect(outcome.published).toHaveLength(1);
    expect(outcome.published[0]?.fanout).toMatchObject({
      epoch: LAST_UNIT_EPOCH,
      horizon: "1",
      originReplicaId: LAST_UNIT_REPLICA_A,
    });
  });

  it("answers malformed and misshapen bodies with an empty 400", async () => {
    const bodies = ["{bad", "", "[1]", '"text"', "null"];
    const outcome = await onPostgres("org-malformed", ({ handler }) =>
      Effect.forEach(bodies, (body) => send(handler, body)),
    );
    for (const response of outcome) {
      expect(response).toMatchObject({ status: 400, body: "" });
    }
  });

  it("answers a data error deep in the envelope as a bad request", async () => {
    const outcome = await onPostgres("org-data-error", ({ handler }) =>
      send(handler, JSON.stringify({ ...lastUnitBuyerAEnvelope, maxBytes: "lots" })),
    );
    expect(outcome.status).toBe(400);
    expect(outcome.body).toBe("");
  });

  it("refuses an envelope for another organization with the protocol code", async () => {
    const outcome = await onPostgres("org-other", ({ handler }) =>
      send(
        handler,
        JSON.stringify({
          ...lastUnitBuyerAEnvelope,
          organizationId: "org-other",
          afterCommitSequence: OrgCommitSequence.make("0"),
        }),
      ),
    );
    expect(outcome.status).toBe(403);
    expect(JSON.parse(outcome.body)).toMatchObject({
      error: { code: "ORGANIZATION_MISMATCH" },
    });
  });

  it("submits with one statement whatever the body holds", async () => {
    const organizationId = "org-counted";
    const actor: InventoryActor = { organizationId, userId: USER_ID };
    const envelope = (source: SyncCommandEnvelope) =>
      JSON.stringify({
        ...source,
        organizationId,
        afterCommitSequence: OrgCommitSequence.make("0"),
      });
    const counted = await onPostgres(organizationId, ({ commands }) =>
      Effect.gen(function* () {
        const committed = yield* countStatements(
          commands.submitRaw(actor, envelope(lastUnitBuyerAEnvelope)),
        );
        const behind = yield* countStatements(
          commands.submitRaw(actor, envelope(lastUnitBuyerBEnvelope)),
        );
        const malformed = yield* countStatements(Effect.flip(commands.submitRaw(actor, "{bad")));
        const listBody = yield* countStatements(Effect.flip(commands.submitRaw(actor, "[1]")));
        const foreign = yield* countStatements(
          Effect.flip(
            commands.submitRaw(
              actor,
              JSON.stringify({
                ...lastUnitBuyerAEnvelope,
                afterCommitSequence: OrgCommitSequence.make("0"),
              }),
            ),
          ),
        );
        return { committed, behind, malformed, listBody, foreign };
      }),
    );
    for (const [name, count] of Object.entries(counted)) {
      expect({ name, roundTrips: count.roundTrips, transactions: count.transactions }).toEqual({
        name,
        roundTrips: 1,
        transactions: 0,
      });
    }
    expect(counted.committed.result.fanout?.originReplicaId).toBe(LAST_UNIT_REPLICA_A);
    expect(JSON.parse(counted.behind.result.body).page.transactions).toHaveLength(2);
    expect(counted.malformed.result).toMatchObject({ _tag: "SyncRequestMalformed" });
    expect(counted.listBody.result).toMatchObject({ _tag: "SyncRequestMalformed" });
    expect(counted.foreign.result).toMatchObject({
      _tag: "SyncProtocolError",
      code: "ORGANIZATION_MISMATCH",
    });
  });
});
