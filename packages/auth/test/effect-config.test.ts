import { describe, expect, it } from "vitest";

import { makeEffectAuthConfig } from "../src/auth";

const secret = "0123456789abcdef".repeat(4);

const config = {
  baseURL: "https://tabaaq.zohaibakber.com",
  electronProtocol: "com.tabaaq.desktop",
  mobileProtocol: "com.tabaaq.mobile",
  secret,
  trustedOrigins: ["https://app.example.com"],
} as const;

describe("makeEffectAuthConfig", () => {
  it("passes a real absolute baseURL so Better Auth can construct its router", () => {
    const { options } = makeEffectAuthConfig(config);

    expect(options.baseURL).toBe("https://tabaaq.zohaibakber.com");
    expect(() => new URL(options.baseURL ?? "")).not.toThrow();
    expect(new URL(options.baseURL ?? "").pathname).toBe("/");
  });

  it("includes native protocol origins without a request", () => {
    const { options, trustedOrigins } = makeEffectAuthConfig(config);
    const resolved = options.trustedOrigins as (request?: Request) => string[];

    expect(resolved()).toEqual(trustedOrigins);
    expect(trustedOrigins).toEqual(
      expect.arrayContaining([
        "https://tabaaq.zohaibakber.com",
        "https://app.example.com",
        "com.tabaaq.desktop:/",
        "com.tabaaq.mobile://",
      ]),
    );
  });

  it("adds the request origin when the request URL is absolute", () => {
    const { options } = makeEffectAuthConfig(config);
    const resolved = options.trustedOrigins as (request?: Request) => string[];
    const origins = resolved(
      new Request("https://preview.example.workers.dev/api/auth/get-session"),
    );

    expect(origins).toContain("https://preview.example.workers.dev");
    expect(origins).toContain("com.tabaaq.desktop:/");
  });

  it("does not throw when Better Auth calls trustedOrigins with a relative URL", () => {
    const { options, trustedOrigins } = makeEffectAuthConfig(config);
    const resolved = options.trustedOrigins as (request?: Request) => string[];

    expect(resolved({ url: "/api/auth/get-session" } as Request)).toEqual(trustedOrigins);
  });
});
