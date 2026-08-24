import { describe, expect, it } from "vitest";

import { makeDesktopContentSecurityPolicy } from "../../electron/content-security-policy";

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
});
