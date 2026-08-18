import { describe, expect, it } from "vitest";

import {
  PRODUCTION_API_DOMAIN_MISSING_MESSAGE,
  PRODUCTION_DOMAIN_MISSING_MESSAGE,
  requireProductionApiHostname,
  requireProductionHostname,
  resolveProductionApiHostname,
  resolveProductionHostname,
} from "../../src/runtime/production-domain";

describe("resolveProductionHostname", () => {
  it("prefers PRODUCTION_DOMAIN over AUTH_TRUSTED_ORIGINS and VITE_API_URL", () => {
    expect(
      resolveProductionHostname({
        PRODUCTION_DOMAIN: "shop.example",
        VITE_API_URL: "https://api.other.example",
        AUTH_TRUSTED_ORIGINS: "https://from-origins.example",
      }),
    ).toBe("shop.example");
  });

  it("parses a hostname out of an origin-shaped PRODUCTION_DOMAIN", () => {
    expect(resolveProductionHostname({ PRODUCTION_DOMAIN: "https://shop.example" })).toBe(
      "shop.example",
    );
  });

  it("does not treat the API host as the site host", () => {
    expect(resolveProductionHostname({ VITE_API_URL: "https://api.shop.example" })).toBe(
      "shop.example",
    );
    expect(resolveProductionHostname({ VITE_API_URL: "https://shop.example" })).toBeUndefined();
  });

  it("falls back to the first AUTH_TRUSTED_ORIGINS host", () => {
    expect(
      resolveProductionHostname({
        AUTH_TRUSTED_ORIGINS: "https://app.example, https://other.example",
      }),
    ).toBe("app.example");
  });

  it("ignores localhost and wildcard trusted origins", () => {
    expect(
      resolveProductionHostname({
        VITE_API_URL: "http://localhost:8787",
        AUTH_TRUSTED_ORIGINS: "*.example.com, exp://*",
      }),
    ).toBeUndefined();
  });
});

describe("resolveProductionApiHostname", () => {
  it("prefers PRODUCTION_API_DOMAIN", () => {
    expect(
      resolveProductionApiHostname({
        PRODUCTION_DOMAIN: "shop.example",
        PRODUCTION_API_DOMAIN: "api.custom.example",
        VITE_API_URL: "https://api.shop.example",
      }),
    ).toBe("api.custom.example");
  });

  it("uses VITE_API_URL when it is not the site host", () => {
    expect(
      resolveProductionApiHostname({
        PRODUCTION_DOMAIN: "shop.example",
        VITE_API_URL: "https://api.shop.example",
      }),
    ).toBe("api.shop.example");
  });

  it("derives api.<site> when VITE_API_URL still points at the apex", () => {
    expect(
      resolveProductionApiHostname({
        PRODUCTION_DOMAIN: "shop.example",
        VITE_API_URL: "https://shop.example",
      }),
    ).toBe("api.shop.example");
  });

  it("derives api.<site> from PRODUCTION_DOMAIN alone", () => {
    expect(resolveProductionApiHostname({ PRODUCTION_DOMAIN: "shop.example" })).toBe(
      "api.shop.example",
    );
  });
});

describe("requireProductionHostname", () => {
  it("fails clearly when no production hostname is configured", () => {
    expect(() => requireProductionHostname({})).toThrow(PRODUCTION_DOMAIN_MISSING_MESSAGE);
  });
});

describe("requireProductionApiHostname", () => {
  it("fails clearly when no API hostname can be derived", () => {
    expect(() => requireProductionApiHostname({})).toThrow(PRODUCTION_API_DOMAIN_MISSING_MESSAGE);
  });
});
