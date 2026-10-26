import { describe, expect, it } from "@effect/vitest";
import { OrgCommitSequence } from "@store/contracts";
import { LAST_UNIT_ORGANIZATION_ID, lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";

import { seedLastUnit } from "../authority/fixtures";
import { scenario, TestAuthorities } from "../authority/harness";
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

const submitTo = Effect.fn("submitTo")(function* (organizationId: string, body: BodyInit) {
  const authorities = yield* TestAuthorities;
  const { db } = yield* authorities.open(LAST_UNIT_ORGANIZATION_ID);
  yield* seedLastUnit(db, organizationId).pipe(Effect.orDie);
  const handler = yield* webHandlerFor({
    claims: claimsFor("owner", LAST_UNIT_ORGANIZATION_ID),
    authorities,
  });
  return yield* Effect.promise(async () => {
    const response = await handler(commandRequest(body));
    return { status: response.status, body: await response.text() };
  });
});

describe("POST /api/sync/commands on the organization authority", () => {
  it.effect("refuses an envelope for another organization with the protocol code", () =>
    Effect.gen(function* () {
      const outcome = yield* submitTo(
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
    }).pipe(scenario),
  );

  it.effect("commits a sale and returns its receipt with the next page", () =>
    Effect.gen(function* () {
      const outcome = yield* submitTo(
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
    }).pipe(scenario),
  );
});
