import type { CommandReceipt } from "@store/contracts";
import { OrgCommitSequence } from "@store/contracts";
import {
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerACommand,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import { describe, expect, it } from "vitest";

import { submitOrganizationObjectCommand } from "../src/replica/command";

const receipt: CommandReceipt = {
  operationId: "sale-a",
  replicaId: LAST_UNIT_REPLICA_A,
  clientSequence: lastUnitBuyerAEnvelope.clientSequence,
  payloadHash: lastUnitBuyerAEnvelope.payloadHash,
  decision: "accepted",
  commitSequence: OrgCommitSequence.make("1"),
  result: {
    _tag: "issueInvoice",
    invoiceId: lastUnitBuyerACommand.invoiceId,
    invoiceNumber: 1,
  },
};

describe("submitOrganizationObjectCommand", () => {
  it("posts the envelope to the broker-allowlisted command route and decodes the receipt", async () => {
    const requests: Array<{
      readonly url: string;
      readonly method: string;
      readonly body: string;
      readonly authorization: string | null;
    }> = [];
    const authenticatedFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push({
        url: request.url,
        method: request.method,
        body: await request.text(),
        authorization: request.headers.get("authorization"),
      });
      return new Response(JSON.stringify(receipt), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const decoded = await submitOrganizationObjectCommand(
      lastUnitBuyerAEnvelope,
      authenticatedFetch,
      "https://api.tabaaq.app",
    );

    expect(requests).toEqual([
      {
        url: "https://api.tabaaq.app/api/sync/commands",
        method: "POST",
        body: JSON.stringify({
          organizationId: "org-1",
          epoch: "1",
          replicaId: "replica-a",
          clientSequence: "1",
          operationId: "sale-a",
          payloadHash: lastUnitBuyerAEnvelope.payloadHash,
          command: {
            _tag: "issueInvoice",
            payload: lastUnitBuyerACommand,
          },
        }),
        authorization: null,
      },
    ]);
    expect(decoded).toEqual(receipt);
  });
});
