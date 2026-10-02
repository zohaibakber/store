import * as PgClient from "@effect/sql-pg/PgClient";
import { OrgCommitSequence } from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  LAST_UNIT_REPLICA_B,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import { batches, categories, inventoryState, products, replicas } from "@store/db/postgres/schema";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeInventoryCommands } from "../../src/inventory/commands";
import { startAuthorityPostgres, type AuthorityPostgres } from "../inventory/authority-postgres";
import { claimsFor, TEST_ACCESS_TOKEN, webHandlerFor } from "../lib/app";

const USER_ID = "user-1";

type WebHandler = (request: Request) => Promise<Response>;

const commandRequest = (body: BodyInit) =>
  new Request("http://localhost/api/sync/commands", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TEST_ACCESS_TOKEN}`,
    },
    body,
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
    use: (handler: WebHandler) => Effect.Effect<A, E>,
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const commands = yield* seed(organizationId);
        const handler = yield* Effect.promise(() =>
          webHandlerFor({
            claims: claimsFor("owner", LAST_UNIT_ORGANIZATION_ID),
            commands,
          }),
        );
        return yield* use(handler);
      }).pipe(Effect.provide(layer()), Effect.scoped),
    );

  const send = (handler: WebHandler, body: BodyInit) =>
    Effect.promise(async () => {
      const response = await handler(commandRequest(body));
      return { status: response.status, body: await response.text() };
    });

  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  it("refuses an envelope for another organization with the protocol code", async () => {
    const outcome = await onPostgres("org-other", (handler) =>
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
});
