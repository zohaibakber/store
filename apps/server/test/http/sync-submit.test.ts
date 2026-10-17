import { OrgCommitSequence } from "@store/contracts";
import { LAST_UNIT_ORGANIZATION_ID, lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { makeInventoryCommands } from "../../src/inventory/commands";
import { seedLastUnit } from "../authority/fixtures";
import { makeTestAuthorities } from "../authority/harness";
import { claimsFor, TEST_ACCESS_TOKEN, webHandlerFor } from "../lib/app";

const commandRequest = (body: BodyInit) =>
  new Request("http://localhost/api/sync/commands", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TEST_ACCESS_TOKEN}`,
    },
    body,
  });

const submitTo = (organizationId: string, body: BodyInit) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const authorities = makeTestAuthorities();
      const { db } = yield* authorities.open(LAST_UNIT_ORGANIZATION_ID);
      yield* seedLastUnit(db, organizationId).pipe(Effect.orDie);
      const handler = yield* Effect.promise(() =>
        webHandlerFor({
          claims: claimsFor("owner", LAST_UNIT_ORGANIZATION_ID),
          commands: makeInventoryCommands(authorities),
        }),
      );
      return yield* Effect.promise(async () => {
        const response = await handler(commandRequest(body));
        return { status: response.status, body: await response.text() };
      });
    }).pipe(Effect.scoped),
  );

describe("POST /api/sync/commands on the organization authority", () => {
  it("refuses an envelope for another organization with the protocol code", async () => {
    const outcome = await submitTo(
      LAST_UNIT_ORGANIZATION_ID,
      JSON.stringify({
        ...lastUnitBuyerAEnvelope,
        organizationId: "org-other",
        afterCommitSequence: OrgCommitSequence.make("0"),
      }),
    );
    expect(outcome.status).toBe(403);
    expect(JSON.parse(outcome.body)).toMatchObject({
      error: { code: "ORGANIZATION_MISMATCH" },
    });
  });

  it("answers a body that is not a command envelope with 400", async () => {
    const outcome = await submitTo(LAST_UNIT_ORGANIZATION_ID, '{"command":1}');
    expect(outcome.status).toBe(400);
  });

  it("commits a sale and returns its receipt with the next page", async () => {
    const outcome = await submitTo(
      LAST_UNIT_ORGANIZATION_ID,
      JSON.stringify({
        ...lastUnitBuyerAEnvelope,
        afterCommitSequence: OrgCommitSequence.make("0"),
      }),
    );
    expect(outcome.status).toBe(200);
    expect(JSON.parse(outcome.body)).toMatchObject({
      decision: "accepted",
      commitSequence: "1",
      page: { horizon: "1", transactions: [{ commitSequence: "1" }] },
    });
  });
});
