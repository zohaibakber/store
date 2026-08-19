import { describe, expect, it } from "vitest";

import { resolveBrowserApiBaseUrl } from "@/lib/api-base-url";

describe("resolveBrowserApiBaseUrl", () => {
  it("uses the configured API origin on the production site host", () => {
    expect(
      resolveBrowserApiBaseUrl({
        configuredApiUrl: "https://api.tabaaq.app/",
        pageOrigin: "https://tabaaq.app",
      }),
    ).toBe("https://api.tabaaq.app");
  });

  it("stays same-origin on a pull-request workers.dev preview", () => {
    expect(
      resolveBrowserApiBaseUrl({
        configuredApiUrl: "https://api.tabaaq.app",
        pageOrigin: "https://tabaaq-website-pr-20.example.workers.dev",
      }),
    ).toBe("");
  });

  it("stays same-origin for local Vite so the /api proxy is used", () => {
    expect(
      resolveBrowserApiBaseUrl({
        configuredApiUrl: "http://localhost:8787",
        pageOrigin: "http://localhost:5174",
      }),
    ).toBe("");
  });

  it("ignores a configured URL that is already this page origin", () => {
    expect(
      resolveBrowserApiBaseUrl({
        configuredApiUrl: "https://tabaaq.app",
        pageOrigin: "https://tabaaq.app",
      }),
    ).toBe("");
  });

  it("returns empty when nothing is configured", () => {
    expect(
      resolveBrowserApiBaseUrl({
        configuredApiUrl: "  ",
        pageOrigin: "https://tabaaq.app",
      }),
    ).toBe("");
  });
});
