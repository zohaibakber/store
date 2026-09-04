import { describe, expect, it } from "vitest";

import {
  failureFromUnknown,
  InventoryFailure,
  inventoryFailureFromHttp,
} from "../src/inventory-failure";

describe("inventoryFailureFromHttp", () => {
  it("uses the server envelope message, not the raw JSON body", () => {
    const failure = inventoryFailureFromHttp(
      409,
      {
        error: {
          code: "ENTITY_CONFLICT",
          message: "The entity changed before this mutation was saved.",
        },
      },
      "Inventory mutation failed.",
    );
    expect(failure).toBeInstanceOf(InventoryFailure);
    expect(failure.message).toBe("The entity changed before this mutation was saved.");
    expect(failure.reason).toEqual({ _tag: "staleReplica" });
  });

  it("classifies an exhausted 401 as unauthenticated", () => {
    const failure = inventoryFailureFromHttp(
      401,
      { error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
      "Inventory mutation failed.",
    );
    expect(failure.reason).toEqual({ _tag: "unauthenticated" });
  });

  it("classifies timeouts, rate limits, and server failures as transient", () => {
    for (const status of [408, 429, 500, 503]) {
      expect(inventoryFailureFromHttp(status, null, "Inventory mutation failed.").reason).toEqual({
        _tag: "transient",
      });
    }
  });

  it("uses a plain-text HTTP body as the message", () => {
    const failure = inventoryFailureFromHttp(
      400,
      "Neon rejected the product batch.",
      "Legacy inventory migration batch failed.",
    );
    expect(failure.message).toBe("Neon rejected the product batch.");
    expect(failure.reason).toEqual({ _tag: "rejected", code: "HTTP_400" });
  });

  it("does not surface a raw JSON object as the error message", () => {
    const failure = inventoryFailureFromHttp(
      400,
      { error: { code: "BAD_REQUEST" } },
      "Inventory mutation failed.",
    );
    expect(failure.message).toBe("Inventory mutation failed.");
    expect(failure.message.startsWith("{")).toBe(false);
  });

  it("retries Electron IPC network failures with the inner message", () => {
    const failure = failureFromUnknown(
      new Error("Error invoking remote method 'inventory:http': Failed to fetch"),
    );
    expect(failure.reason).toEqual({ _tag: "transport" });
    expect(failure.message).toBe("Failed to fetch");
  });

  it("classifies other 4xx, including a 409 that is not ENTITY_CONFLICT, as rejected", () => {
    const reused = inventoryFailureFromHttp(
      409,
      {
        error: { code: "OPERATION_ID_REUSED", message: "This operation id is already in use." },
      },
      "Inventory mutation failed.",
    );
    expect(reused.reason).toEqual({ _tag: "rejected", code: "OPERATION_ID_REUSED" });

    const forbidden = inventoryFailureFromHttp(
      403,
      { error: { code: "ORGANIZATION_MISMATCH", message: "Wrong organization." } },
      "Inventory mutation failed.",
    );
    expect(forbidden.reason).toEqual({ _tag: "rejected", code: "ORGANIZATION_MISMATCH" });
  });
});
