import type { ProductScanAiClient } from "@store/services";
import { describe, expect, it, vi } from "vitest";

import { appFor } from "../lib/app";

const scan = (recognizedText = "Panadol Paracetamol 500mg Batch B-42 EXP 12/2027") =>
  ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recognizedText, mode: "product" }),
  }) satisfies RequestInit;

const result = {
  name: "Panadol",
  composition: "Paracetamol",
  strength: "500mg",
  unitsPerPack: 20,
  batchNumber: "B-42",
  expiresAt: "2027-12",
  confidence: 0.95,
};

const productAi = (generate = vi.fn(async () => JSON.stringify(result))) => ({
  client: { generate } satisfies ProductScanAiClient,
  generate,
});

describe("product scan authorization and validation", () => {
  it("does not reach the model when the caller is unauthorized", async () => {
    const { client, generate } = productAi();
    const response = await appFor(false, {
      productScanAi: client,
    }).request("/api/product-scans", scan());

    expect(response.status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects invalid scan input", async () => {
    const response = await appFor(true).request("/api/product-scans", scan(""));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_PRODUCT_SCAN" } });
  });

  it("enforces the request body limit before schema decoding", async () => {
    const response = await appFor(true).request("/api/product-scans", scan("x".repeat(100 * 1024)));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "PRODUCT_SCAN_TOO_LARGE" } });
  });

  it("returns a typed rate-limit response", async () => {
    const response = await appFor(true, {
      productScanAllowed: false,
    }).request("/api/product-scans", scan());

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: "PRODUCT_SCAN_RATE_LIMITED" } });
  });
});

describe("product scan extraction", () => {
  it("returns the normalized model result", async () => {
    const { client, generate } = productAi();
    const response = await appFor(true, {
      productScanAi: client,
    }).request("/api/product-scans", scan());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(result);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("does not leak an upstream model failure", async () => {
    const { client } = productAi(
      vi.fn(async () => {
        throw new Error("workers ai private neuron failure");
      }),
    );
    const response = await appFor(true, {
      productScanAi: client,
    }).request("/api/product-scans", scan());
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(502);
    expect(body).toContain("PRODUCT_SCAN_FAILED");
    expect(body).not.toContain("private neuron");
  });
});
