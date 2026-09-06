import { describe, expect, it } from "vitest";

import { makeDesktopContentSecurityPolicy } from "../../electron/content-security-policy";
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
  it("permits WebAssembly compilation without allowing general eval in production", () => {
    const scriptSources = productionPolicy()
      .split("; ")
      .find((directive) => directive.startsWith("script-src "))
      ?.split(" ");

    expect(scriptSources).toContain("'wasm-unsafe-eval'");
    expect(scriptSources).not.toContain("'unsafe-eval'");
    expect(scriptSources).not.toContain("'unsafe-inline'");
  });

  it("permits production API, auth, and Sentry ingest connections", () => {
    const connectSources = productionPolicy()
      .split("; ")
      .find((directive) => directive.startsWith("connect-src "))
      ?.split(" ");

    expect(connectSources).toContain("https://api.tabaaq.app");
    expect(connectSources).toContain("wss://api.tabaaq.app");
    expect(connectSources).toContain("https://auth.tabaaq.app");
    expect(connectSources).toContain("https://*.ingest.sentry.io");
    expect(connectSources).toContain("https://*.ingest.us.sentry.io");
    expect(connectSources).not.toContain("https:");
    expect(connectSources).not.toContain("wss:");
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
