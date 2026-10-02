import { describe, expect, it } from "vitest";

import { makeDesktopContentSecurityPolicy } from "../../electron/content-security-policy";
import { isOAuthCallbackUrl } from "../../electron/oauth-callback";
import { developmentRendererTarget } from "../../electron/protocol";
import { isAllowedRendererNavigation } from "../../electron/renderer-navigation";

const policyFor = (options: { readonly development?: boolean } = {}) =>
  makeDesktopContentSecurityPolicy({
    scheme: "com.tabaaq.desktop",
    apiOrigin: options.development ? "http://localhost:8787" : "https://api.tabaaq.app",
    development: options.development ?? false,
  });

const directive = (policy: string, name: string) =>
  policy
    .split("; ")
    .find((entry) => entry.startsWith(`${name} `))
    ?.split(" ");

describe("desktop content security policy", () => {
  it("keeps production script-src to self", () => {
    expect(directive(policyFor(), "script-src")).toEqual(["script-src", "'self'"]);
  });

  it("limits production connections, frames, and workers to known origins", () => {
    const policy = policyFor();
    const connectSources = directive(policy, "connect-src");
    expect(connectSources).toContain("https://*.ingest.sentry.io");
    expect(connectSources).toContain("https://*.ingest.us.sentry.io");
    expect(connectSources).toContain("wss://api.tabaaq.app");
    expect(connectSources).not.toContain("https:");
    expect(connectSources).not.toContain("wss:");
    expect(policy).not.toContain("challenges.cloudflare.com");
    expect(directive(policy, "frame-src")).toEqual(["frame-src", "'self'"]);
    expect(directive(policy, "worker-src")).toEqual(["worker-src", "'self'"]);
  });
});

describe("desktop development renderer target", () => {
  it("keeps renderer requests on the configured development origin", () => {
    expect(
      developmentRendererTarget(
        "http://127.0.0.1:5174",
        new URL("com.tabaaq.desktop://app/assets/app.js?version=1"),
      )?.href,
    ).toBe("http://127.0.0.1:5174/assets/app.js?version=1");
    expect(
      developmentRendererTarget(
        "http://127.0.0.1:5174",
        new URL("com.tabaaq.desktop://app//attacker.example/payload"),
      ),
    ).toBeNull();
  });
});

describe("desktop renderer navigation allowlist", () => {
  it("rejects origins that only share a string prefix", () => {
    expect(
      isAllowedRendererNavigation("http://127.0.0.1:5173.attacker.example/", [
        "http://127.0.0.1:5173",
      ]),
    ).toBe(false);
    expect(
      isAllowedRendererNavigation("com.tabaaq.desktop://app.attacker.example/", [
        "com.tabaaq.desktop://app",
      ]),
    ).toBe(false);
    expect(
      isAllowedRendererNavigation("http://127.0.0.1:5173/settings", ["http://127.0.0.1:5173"]),
    ).toBe(true);
    expect(
      isAllowedRendererNavigation("com.tabaaq.desktop://app/inventory", [
        "com.tabaaq.desktop://app",
      ]),
    ).toBe(true);
  });
});

describe("desktop OAuth callback allow-list", () => {
  it("accepts only the app scheme's auth callback path", () => {
    expect(
      isOAuthCallbackUrl(
        "com.tabaaq.desktop://auth/callback?code=authorization-code",
        "com.tabaaq.desktop",
      ),
    ).toBe(true);
    expect(
      isOAuthCallbackUrl("https://auth/callback?code=authorization-code", "com.tabaaq.desktop"),
    ).toBe(false);
    expect(
      isOAuthCallbackUrl(
        "com.tabaaq.desktop://auth/not-callback?code=authorization-code",
        "com.tabaaq.desktop",
      ),
    ).toBe(false);
    expect(
      isOAuthCallbackUrl(
        "com.tabaaq.desktop://app/callback?code=authorization-code",
        "com.tabaaq.desktop",
      ),
    ).toBe(false);
    expect(isOAuthCallbackUrl("not a url", "com.tabaaq.desktop")).toBe(false);
  });
});
