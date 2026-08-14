import { betterAuth } from "better-auth";
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

  it("resolves the origin forms Better Auth documents instead of throwing", () => {
    const { rejectedSettings, trustedOrigins } = makeEffectAuthConfig({
      ...config,
      // Every one of these throws `TypeError: Invalid URL string` from
      // `new URL`, which used to abort Worker start-up on every request.
      trustedOrigins: ["tabaaq.zohaibakber.com", "*.tabaaq.zohaibakber.com", "exp://192.168.*.*:*"],
    });

    expect(rejectedSettings).toEqual([]);
    expect(trustedOrigins).toEqual(
      expect.arrayContaining([
        "https://tabaaq.zohaibakber.com",
        "https://*.tabaaq.zohaibakber.com",
        "exp://192.168.*.*:*",
      ]),
    );
  });

  it("reports an unusable trusted origin rather than failing the whole config", () => {
    const { rejectedSettings, trustedOrigins } = makeEffectAuthConfig({
      ...config,
      trustedOrigins: ["https://app.example.com", "http://insecure.example.com"],
    });

    expect(trustedOrigins).toContain("https://app.example.com");
    expect(rejectedSettings).toEqual([
      {
        setting: "AUTH_TRUSTED_ORIGINS",
        value: "http://insecure.example.com",
        reason: "must use HTTPS outside local development",
      },
    ]);
  });

  it("serves sign-in when the configured trusted origins are unusable", async () => {
    const { options } = makeEffectAuthConfig({ ...config, trustedOrigins: ["not-a-url:::"] });
    const auth = betterAuth({ ...options, secret });

    const response = await auth.handler(
      new Request("https://tabaaq.zohaibakber.com/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://tabaaq.zohaibakber.com",
          cookie: "better-auth.session_token=stale",
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ email: "owner@example.com", password: "password12" }),
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("lets Better Auth accept a wildcard origin and still refuse one outside it", async () => {
    const { options } = makeEffectAuthConfig({
      ...config,
      trustedOrigins: ["*.tabaaq.zohaibakber.com"],
    });
    const auth = betterAuth({ ...options, secret });
    const signIn = (origin: string) =>
      auth.handler(
        new Request("https://tabaaq.zohaibakber.com/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin,
            cookie: "better-auth.session_token=stale",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-site",
          },
          body: JSON.stringify({ email: "owner@example.com", password: "password12" }),
        }),
      );

    // The origin is trusted, so the request reaches credential checking.
    const covered = await signIn("https://app.tabaaq.zohaibakber.com");
    expect(covered.status).not.toBe(403);

    const outside = await signIn("https://tabaaq.zohaibakber.com.evil.example");
    expect(outside.status).toBe(403);
  });

  it("handles Electron email sign-in without an uncaught error", async () => {
    const { options } = makeEffectAuthConfig(config);
    const auth = betterAuth({
      ...options,
      secret,
    });
    const response = await auth.handler(
      new Request("https://tabaaq.zohaibakber.com/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "com.tabaaq.desktop:/",
          "electron-origin": "com.tabaaq.desktop:/",
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "no-cors",
          "sec-fetch-site": "none",
        },
        body: JSON.stringify({ email: "owner@example.com", password: "password12" }),
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});
