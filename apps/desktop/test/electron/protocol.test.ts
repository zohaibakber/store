import { describe, expect, it } from "vitest";

import { makeDesktopContentSecurityPolicy } from "../../electron/content-security-policy";
import { isAllowedRendererNavigation } from "../../electron/renderer-navigation";

const productionPolicy = () =>
  makeDesktopContentSecurityPolicy({
    scheme: "com.tabaaq.desktop",
    apiOrigin: "https://api.tabaaq.app",
    authOrigin: "https://auth.tabaaq.app",
    development: false,
  });

describe("desktop content security policy", () => {
  it("permits WebAssembly compilation without allowing general eval in production", () => {
    const scriptSources = productionPolicy()
      .split("; ")
      .find((directive) => directive.startsWith("script-src "))
      ?.split(" ");

    expect(scriptSources).toContain("'wasm-unsafe-eval'");
    expect(scriptSources).not.toContain("'unsafe-eval'");
  });

  it("permits production PowerSync Cloud and Sentry ingest connections", () => {
    const connectSources = productionPolicy()
      .split("; ")
      .find((directive) => directive.startsWith("connect-src "))
      ?.split(" ");

    expect(connectSources).toContain("https://*.powersync.journeyapps.com");
    expect(connectSources).toContain("wss://*.powersync.journeyapps.com");
    expect(connectSources).toContain("https://*.ingest.sentry.io");
    expect(connectSources).toContain("https://*.ingest.us.sentry.io");
    expect(connectSources).not.toContain("https:");
    expect(connectSources).not.toContain("wss:");
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
