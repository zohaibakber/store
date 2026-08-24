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

  it("rejects inventory posts that are not on the command allowlist", () => {
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/inventory/not-a-command",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
  });
});
