import { describe, expect, it } from "vitest";

import {
  MAX_INVENTORY_CATALOG_BODY_BYTES,
  MAX_INVENTORY_COMMAND_BODY_BYTES,
  assertInventoryRequestBodySize,
  maxInventoryRequestBodyBytes,
  validatedInventoryUrl,
} from "../../electron/inventory-http";

const apiBaseUrl = "https://api.tabaaq.app";

describe("desktop inventory HTTP allowlist", () => {
  it("allows signed-in catalog backup and reconciliation posts", () => {
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/inventory/legacy-migrations",
      }),
    ).toBe("https://api.tabaaq.app/api/inventory/legacy-migrations");
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/inventory/legacy-reconciliations",
      }),
    ).toBe("https://api.tabaaq.app/api/inventory/legacy-reconciliations");
  });

  it("allows polling one legacy migration job", () => {
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: "https://api.tabaaq.app/api/inventory/legacy-migrations/job-123",
      }),
    ).toBe("https://api.tabaaq.app/api/inventory/legacy-migrations/job-123");
  });

  it.each([
    "https://api.tabaaq.app/api/inventory/legacy-migrations",
    "https://api.tabaaq.app/api/inventory/legacy-migrations/job-123/details",
    "https://api.tabaaq.app/api/inventory/legacy-migrations/job%2F123",
    "https://api.tabaaq.app/api/inventory/products",
  ])("rejects non-status inventory GET %s", (url) => {
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url,
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
  });

  it("allows a catalog snapshot larger than 1 MiB on the migration routes", () => {
    expect(
      maxInventoryRequestBodyBytes(
        apiBaseUrl,
        "https://api.tabaaq.app/api/inventory/legacy-migrations",
      ),
    ).toBe(MAX_INVENTORY_CATALOG_BODY_BYTES);
    expect(
      maxInventoryRequestBodyBytes(
        apiBaseUrl,
        "https://api.tabaaq.app/api/inventory/legacy-reconciliations",
      ),
    ).toBe(MAX_INVENTORY_CATALOG_BODY_BYTES);
    expect(
      maxInventoryRequestBodyBytes(apiBaseUrl, "https://api.tabaaq.app/api/inventory/mutations"),
    ).toBe(MAX_INVENTORY_COMMAND_BODY_BYTES);

    const catalogBody = new ArrayBuffer(MAX_INVENTORY_COMMAND_BODY_BYTES + 1);
    expect(() =>
      assertInventoryRequestBodySize(apiBaseUrl, {
        url: "https://api.tabaaq.app/api/inventory/legacy-migrations",
        body: catalogBody,
      }),
    ).not.toThrow();
    expect(() =>
      assertInventoryRequestBodySize(apiBaseUrl, {
        url: "https://api.tabaaq.app/api/inventory/mutations",
        body: catalogBody,
      }),
    ).toThrow("The inventory request body exceeds the 1 MiB limit.");
    expect(() =>
      assertInventoryRequestBodySize(apiBaseUrl, {
        url: "https://api.tabaaq.app/api/inventory/legacy-migrations",
        body: new ArrayBuffer(MAX_INVENTORY_CATALOG_BODY_BYTES + 1),
      }),
    ).toThrow("The inventory request body exceeds the 32 MiB limit.");
  });

  it("rejects inventory posts that are not on the command allowlist", () => {
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/inventory/not-a-command",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
  });
});
