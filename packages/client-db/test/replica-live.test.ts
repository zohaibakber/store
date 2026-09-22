import { OrgCommitSequence, SyncLiveWakeHint } from "@store/contracts";
import { LAST_UNIT_ORGANIZATION_ID, LAST_UNIT_REPLICA_A } from "@store/contracts/sync/fixtures";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  connectOrganizationObjectLiveTransport,
  type OrganizationObjectLiveEngine,
} from "../src/replica/live";

const nonce = "ab".repeat(32);

const ticket = {
  nonce,
  organizationId: LAST_UNIT_ORGANIZATION_ID,
  subscription: "operational" as const,
  expiresAt: 1_700_000_030_000,
};

const wakeHint = {
  epoch: "1",
  subscription: "operational" as const,
  horizon: OrgCommitSequence.make("12"),
};

type RecordedRequest = {
  readonly url: string;
  readonly method: string;
  readonly accept: string | null;
};

const mintThenSseFetch =
  (requests: Array<RecordedRequest>, body: string): typeof fetch =>
  async (input, init) => {
    const request = new Request(input, init);
    requests.push({
      url: request.url,
      method: request.method,
      accept: request.headers.get("accept"),
    });
    if (request.url.includes("/live-tickets")) {
      return new Response(JSON.stringify(ticket), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };

describe("connectOrganizationObjectLiveTransport", () => {
  it("mints a ticket and opens an authenticated SSE wake stream", async () => {
    const requests: Array<RecordedRequest> = [];
    const wakes: Array<string> = [];
    const engine: OrganizationObjectLiveEngine = {
      appliedCursor: () => "0",
      onWake: (horizon) => {
        wakes.push(horizon);
      },
      resumeFromCursor: () => undefined,
    };
    const sseBody = `event: wake\ndata: ${JSON.stringify(wakeHint)}\n\n`;
    const transport = await connectOrganizationObjectLiveTransport(
      mintThenSseFetch(requests, sseBody),
      "https://api.tabaaq.app",
      LAST_UNIT_REPLICA_A,
      engine,
    );
    expect(transport).toBeDefined();
    expect(requests[0]).toMatchObject({
      url: "https://api.tabaaq.app/api/sync/live-tickets",
      method: "POST",
    });
    expect(requests[1]?.url).toContain(
      `https://api.tabaaq.app/api/sync/live?nonce=${nonce}&replicaId=replica-a&subscription=operational`,
    );
    expect(requests[1]?.accept).toBe("text/event-stream");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(wakes).toEqual(["12"]);
    transport?.close();
  });

  it("returns undefined when the live upgrade is unavailable so HTTP polling continues", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const request = new Request(input);
      if (request.url.includes("/live-tickets")) {
        return new Response(JSON.stringify(ticket), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: { code: "TICKET_INVALID", message: "no" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    };
    const transport = await connectOrganizationObjectLiveTransport(
      fetchImpl,
      "https://api.tabaaq.app",
      LAST_UNIT_REPLICA_A,
      {
        appliedCursor: () => "0",
        onWake: () => undefined,
        resumeFromCursor: () => undefined,
      },
    );
    expect(transport).toBeUndefined();
  });

  it("decodes SyncLiveWakeHint payloads", () => {
    expect(Schema.decodeUnknownSync(SyncLiveWakeHint)(wakeHint)).toEqual(wakeHint);
  });
});
