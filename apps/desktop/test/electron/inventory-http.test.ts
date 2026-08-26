import { describe, expect, it } from "vitest";

import { validatedInventoryUrl } from "../../electron/inventory-http";

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

  it("rejects inventory posts that are not on the command allowlist", () => {
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/inventory/not-a-command",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
  });
});
