import { describe, expect, it } from "vitest";

import {
  MAX_INVENTORY_COMMAND_BODY_BYTES,
  assertInventoryRequestBodySize,
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
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/inventory/pull",
      }),
    ).toBe("https://api.tabaaq.app/api/inventory/pull");
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/inventory/snapshot",
      }),
    ).toBe("https://api.tabaaq.app/api/inventory/snapshot");
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
});
