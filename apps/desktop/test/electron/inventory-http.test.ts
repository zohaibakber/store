import {
  connectOrganizationObjectLiveTransport,
  submitOrganizationObjectCommand,
} from "@store/client-db";
import type { CommandReceipt } from "@store/contracts";
import { OrgCommitSequence } from "@store/contracts";
import {
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerACommand,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import { describe, expect, it } from "vitest";

import {
  MAX_INVENTORY_COMMAND_BODY_BYTES,
  assertInventoryRequestBodySize,
  readInventoryHttpBackend,
  validatedInventoryUrl,
} from "../../electron/inventory-http";

const apiBaseUrl = "https://api.tabaaq.app";

describe("desktop inventory HTTP allowlist", () => {
  it("allows inventory command posts", () => {
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/inventory/mutations",
      }),
    ).toBe("https://api.tabaaq.app/api/inventory/mutations");
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/inventory/imports",
      }),
    ).toBe("https://api.tabaaq.app/api/inventory/imports");
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/inventory/invoices",
      }),
    ).toBe("https://api.tabaaq.app/api/inventory/invoices");
  });

  it("allows PowerSync credential fetches", () => {
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: "https://api.tabaaq.app/api/powersync/credentials",
      }),
    ).toBe("https://api.tabaaq.app/api/powersync/credentials");
  });

  it("allows the sync command and receipt routes", () => {
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/sync/commands",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/commands");
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/sync/replicas",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/replicas");
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/sync/pull",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/pull");
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: "https://api.tabaaq.app/api/sync/receipts/sale-a",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/receipts/sale-a");
  });

  it("allows snapshot, live-ticket, and nonce live routes", () => {
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/sync/snapshots",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/snapshots");
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/sync/live-tickets",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/live-tickets");
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: "https://api.tabaaq.app/api/sync/snapshots/snap-1/parts/1",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/snapshots/snap-1/parts/1");
    const nonce = "ab".repeat(32);
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: `https://api.tabaaq.app/api/sync/live?nonce=${nonce}`,
      }),
    ).toBe(`https://api.tabaaq.app/api/sync/live?nonce=${nonce}`);
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: `https://api.tabaaq.app/api/sync/live?nonce=${nonce}&replicaId=replica-a&subscription=operational`,
      }),
    ).toBe(
      `https://api.tabaaq.app/api/sync/live?nonce=${nonce}&replicaId=replica-a&subscription=operational`,
    );
  });

  it("rejects live sync without a nonce and unknown sync paths", () => {
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: "https://api.tabaaq.app/api/sync/live",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/sync/live",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
  });

  it("rejects a path that would leak credentials", () => {
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: "https://api.tabaaq.app/v1/session/refresh",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/v1/session/refresh",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
  });

  it.each([
    "https://api.tabaaq.app/api/inventory/legacy-migrations",
    "https://api.tabaaq.app/api/inventory/legacy-migrations/job-123",
    "https://api.tabaaq.app/api/inventory/products",
  ])("rejects leftover or unknown inventory GET %s", (url) => {
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url,
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
  });

  it("rejects command bodies larger than 1 MiB", () => {
    const oversized = new ArrayBuffer(MAX_INVENTORY_COMMAND_BODY_BYTES + 1);
    expect(() =>
      assertInventoryRequestBodySize(apiBaseUrl, {
        url: "https://api.tabaaq.app/api/inventory/mutations",
        body: oversized,
      }),
    ).toThrow("The inventory request body exceeds the 1 MiB limit.");
  });

  it("rejects inventory posts that are not on the command allowlist", () => {
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/inventory/legacy-migrations",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/inventory/not-a-command",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
  });

  it("selects the inventory backend explicitly from configuration", () => {
    expect(readInventoryHttpBackend(undefined)).toEqual({ _tag: "organizationObject" });
    expect(readInventoryHttpBackend("")).toEqual({ _tag: "organizationObject" });
    expect(readInventoryHttpBackend("organizationObject")).toEqual({
      _tag: "organizationObject",
    });
    expect(readInventoryHttpBackend("powerSync")).toEqual({ _tag: "powerSync" });
    expect(() => readInventoryHttpBackend("both")).toThrow("Unsupported inventory backend: both");
  });

  it("allows the command URL the renderer posts and never sees a token", async () => {
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
    const requests: Array<{
      readonly url: string;
      readonly method: string;
      readonly authorization: string | null;
    }> = [];
    const authenticatedFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push({
        url: request.url,
        method: request.method,
        authorization: request.headers.get("authorization"),
      });
      return new Response(JSON.stringify(receipt), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await submitOrganizationObjectCommand(lastUnitBuyerAEnvelope, authenticatedFetch, apiBaseUrl);
    expect(requests).toEqual([
      {
        url: "https://api.tabaaq.app/api/sync/commands",
        method: "POST",
        authorization: null,
      },
    ]);
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/sync/commands",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/commands");
  });

  it("mints live tickets through the broker without handing a refresh token to the socket", async () => {
    const nonce = "ab".repeat(32);
    const requests: Array<{
      readonly url: string;
      readonly method: string;
      readonly authorization: string | null;
    }> = [];
    const urls: Array<string> = [];
    const authenticatedFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push({
        url: request.url,
        method: request.method,
        authorization: request.headers.get("authorization"),
      });
      return new Response(
        JSON.stringify({
          nonce,
          organizationId: "org-1",
          subscription: "operational",
          expiresAt: 1_700_000_030_000,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    await connectOrganizationObjectLiveTransport(
      authenticatedFetch,
      apiBaseUrl,
      LAST_UNIT_REPLICA_A,
      {
        feed: () => ({ _tag: "following" }),
        appliedCursor: () => "0",
        applyTransactions: () => false,
        applyReceipt: () => undefined,
        resumeFromCursor: () => undefined,
      },
      (url) => {
        urls.push(url);
        return {
          send: () => undefined,
          close: () => undefined,
          isOpen: () => true,
        };
      },
    );
    expect(requests).toEqual([
      {
        url: "https://api.tabaaq.app/api/sync/live-tickets",
        method: "POST",
        authorization: null,
      },
    ]);
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/sync/live-tickets",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/live-tickets");
    expect(urls).toEqual([
      `wss://api.tabaaq.app/api/sync/live?nonce=${nonce}&replicaId=replica-a&subscription=operational`,
    ]);
    expect(urls[0]?.includes("refresh")).toBe(false);
    expect(urls[0]?.includes("Bearer")).toBe(false);
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: `https://api.tabaaq.app/api/sync/live?nonce=${nonce}&replicaId=replica-a&subscription=operational`,
      }),
    ).toBe(
      `https://api.tabaaq.app/api/sync/live?nonce=${nonce}&replicaId=replica-a&subscription=operational`,
    );
  });
});
