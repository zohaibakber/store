import { describe, expect, it } from "vitest";

import {
  isLegacyPowerSyncWorkerPath,
  makeDesktopContentSecurityPolicy,
} from "../../electron/content-security-policy";
import { isOAuthCallbackUrl } from "../../electron/oauth-callback";
import { developmentRendererTarget } from "../../electron/protocol";
import { isAllowedRendererNavigation } from "../../electron/renderer-navigation";

const productionPolicy = () =>
  makeDesktopContentSecurityPolicy({
    scheme: "com.tabaaq.desktop",
    apiOrigin: "https://api.tabaaq.app",
    authOrigin: "https://auth.tabaaq.app",
    development: false,
  });

describe("desktop content security policy", () => {
  it("permits Vite's injected React refresh preamble in development", () => {
    const policy = makeDesktopContentSecurityPolicy({
      scheme: "com.tabaaq.desktop",
      apiOrigin: "http://localhost:8787",
      authOrigin: "http://localhost:8788",
      development: true,
    });
    const scriptSources = policy
      .split("; ")
      .find((directive) => directive.startsWith("script-src "))
      ?.split(" ");

    expect(scriptSources).toContain("'unsafe-eval'");
    expect(scriptSources).toContain("'unsafe-inline'");
  });

  it("keeps production script-src free of eval and wasm eval", () => {
    const scriptSources = productionPolicy()
      .split("; ")
      .find((directive) => directive.startsWith("script-src "))
      ?.split(" ");

    expect(scriptSources).toEqual(["script-src", "'self'"]);
    expect(scriptSources).not.toContain("'wasm-unsafe-eval'");
    expect(scriptSources).not.toContain("'unsafe-eval'");
    expect(scriptSources).not.toContain("'unsafe-inline'");
  });

  it("allows wasm compilation only for the legacy PowerSync database worker", () => {
    const workerScriptSources = makeDesktopContentSecurityPolicy({
      scheme: "com.tabaaq.desktop",
      apiOrigin: "https://api.tabaaq.app",
      authOrigin: "https://auth.tabaaq.app",
      development: false,
      wasm: true,
    })
      .split("; ")
      .find((directive) => directive.startsWith("script-src "))
      ?.split(" ");

    expect(workerScriptSources).toEqual(["script-src", "'self'", "'wasm-unsafe-eval'"]);
    expect(isLegacyPowerSyncWorkerPath("/assets/WASQLiteDB.worker-CKuXHS5K.js")).toBe(true);
    expect(isLegacyPowerSyncWorkerPath("/assets/index-CKuXHS5K.js")).toBe(false);
    expect(isLegacyPowerSyncWorkerPath("/assets/WASQLiteDB.worker-x.js/../index.js")).toBe(false);
    expect(isLegacyPowerSyncWorkerPath("/WASQLiteDB.worker-CKuXHS5K.js")).toBe(false);
  });

  it("permits production Sentry ingest connections", () => {
    const connectSources = productionPolicy()
      .split("; ")
      .find((directive) => directive.startsWith("connect-src "))
      ?.split(" ");

    expect(connectSources).toContain("https://*.ingest.sentry.io");
    expect(connectSources).toContain("https://*.ingest.us.sentry.io");
    expect(connectSources).toContain("wss://api.tabaaq.app");
    expect(connectSources).not.toContain("https://*.powersync.journeyapps.com");
    expect(connectSources).not.toContain("wss://*.powersync.journeyapps.com");
    expect(connectSources).not.toContain("https://challenges.cloudflare.com");
    expect(connectSources).not.toContain("https:");
    expect(connectSources).not.toContain("wss:");
  });

  it("does not allow Clerk Turnstile or blob workers in production", () => {
    const policy = productionPolicy();
    expect(policy).toContain("frame-src 'self'");
    expect(policy).not.toContain("challenges.cloudflare.com");
    expect(policy).toContain("worker-src 'self'");
    expect(policy).not.toContain("worker-src 'self' blob:");
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
