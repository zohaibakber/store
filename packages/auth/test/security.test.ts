import { describe, expect, it } from "vitest";

import {
  DEFAULT_ELECTRON_PROTOCOL,
  DEFAULT_MOBILE_PROTOCOL,
  fallbackIfBlank,
  isTrustedOrigin,
  parseTrustedOrigins,
  resolveAuthSecurity,
} from "../src/security";

const secureInput = {
  baseURL: "https://api.example.com",
  electronProtocol: "com.tabaaq.desktop",
  mobileProtocol: "com.tabaaq.mobile",
  trustedOrigins: ["https://app.example.com"],
} as const;

describe("GitHub env fallbacks", () => {
  it("treats blank Actions interpolations as missing", () => {
    expect(fallbackIfBlank(undefined, DEFAULT_ELECTRON_PROTOCOL)).toBe(DEFAULT_ELECTRON_PROTOCOL);
    expect(fallbackIfBlank("", DEFAULT_ELECTRON_PROTOCOL)).toBe(DEFAULT_ELECTRON_PROTOCOL);
    expect(fallbackIfBlank("  ", DEFAULT_MOBILE_PROTOCOL)).toBe(DEFAULT_MOBILE_PROTOCOL);
    expect(fallbackIfBlank("com.custom.desktop", DEFAULT_ELECTRON_PROTOCOL)).toBe(
      "com.custom.desktop",
    );
  });

  it("parses comma-separated trusted origins and drops blanks", () => {
    expect(parseTrustedOrigins(undefined)).toEqual([]);
    expect(parseTrustedOrigins("")).toEqual([]);
    expect(parseTrustedOrigins(" https://app.example.com, ,https://admin.example.com ")).toEqual([
      "https://app.example.com",
      "https://admin.example.com",
    ]);
  });

  it("parses lists written with spaces or wrapping quotes", () => {
    expect(parseTrustedOrigins("https://app.example.com https://admin.example.com")).toEqual([
      "https://app.example.com",
      "https://admin.example.com",
    ]);
    expect(parseTrustedOrigins('"https://app.example.com"')).toEqual(["https://app.example.com"]);
    expect(parseTrustedOrigins("'https://app.example.com','https://admin.example.com'")).toEqual([
      "https://app.example.com",
      "https://admin.example.com",
    ]);
  });
});

describe("resolveAuthSecurity", () => {
  it("normalizes and deduplicates exact trusted origins", () => {
    const resolved = resolveAuthSecurity({
      ...secureInput,
      trustedOrigins: [
        "https://app.example.com",
        "https://app.example.com",
        "http://localhost:5173",
      ],
    });

    expect(resolved).toEqual({
      baseURL: "https://api.example.com",
      electronOrigin: "com.tabaaq.desktop://app",
      electronProtocol: "com.tabaaq.desktop",
      mobileOrigin: "com.tabaaq.mobile://",
      mobileProtocol: "com.tabaaq.mobile",
      secureCookies: true,
      trustedOrigins: [
        "https://api.example.com",
        "https://app.example.com",
        "http://localhost:5173",
        "com.tabaaq.desktop://app",
        "com.tabaaq.mobile://",
        "com.tabaaq.mobile.debug://",
      ],
      rejectedSettings: [],
    });
  });

  it.each([
    ["app.example.com", "https://app.example.com"],
    ["https://app.example.com/", "https://app.example.com"],
    ["https://*.example.com", "https://*.example.com"],
    ["*.example.com", "https://*.example.com"],
    ["preview-*.example.com", "https://preview-*.example.com"],
    ["myapp://", "myapp://"],
    ["exp://192.168.*.*:*", "exp://192.168.*.*:*"],
  ])("accepts documented origin forms: %s", (configured, expected) => {
    const resolved = resolveAuthSecurity({ ...secureInput, trustedOrigins: [configured] });

    expect(resolved.rejectedSettings).toEqual([]);
    expect(resolved.trustedOrigins).toContain(expected);
  });

  it.each([
    "http://api.example.com",
    "https://user:password@app.example.com",
    "https://app.example.com/path",
    "file:///tmp/auth",
    "*",
    "https://*",
    "*.com",
    "not a url",
  ])("drops an unusable or over-broad origin instead of failing: %s", (origin) => {
    const resolved = resolveAuthSecurity({ ...secureInput, trustedOrigins: [origin] });

    expect(resolved.rejectedSettings.map((rejected) => rejected.value)).toEqual([origin]);
    expect(resolved.trustedOrigins).not.toContain(origin);
    expect(resolved.trustedOrigins).toContain("https://api.example.com");
  });

  it("keeps the usable origins when one entry in the list is unusable", () => {
    const resolved = resolveAuthSecurity({
      ...secureInput,
      trustedOrigins: ["tabaaq.example.com", "http://insecure.example.com"],
    });

    expect(resolved.trustedOrigins).toContain("https://tabaaq.example.com");
    expect(resolved.rejectedSettings).toEqual([
      {
        setting: "AUTH_TRUSTED_ORIGINS",
        value: "http://insecure.example.com",
        reason: "must use HTTPS outside local development",
      },
    ]);
  });

  it("expands a bare loopback host to HTTP only in local development", () => {
    const local = resolveAuthSecurity({
      ...secureInput,
      baseURL: "http://localhost:8787",
      trustedOrigins: ["localhost:5173"],
    });
    expect(local.trustedOrigins).toContain("http://localhost:5173");
    expect(local.trustedOrigins).toContain("https://localhost:5173");

    const production = resolveAuthSecurity({ ...secureInput, trustedOrigins: ["localhost:5173"] });
    expect(production.trustedOrigins).toContain("https://localhost:5173");
    expect(production.trustedOrigins).not.toContain("http://localhost:5173");
  });

  it("allows HTTP only for local development origins", () => {
    const resolved = resolveAuthSecurity({
      ...secureInput,
      baseURL: "http://localhost:8787",
    });
    expect(resolved.secureCookies).toBe(false);
    expect(resolved.trustedOrigins).toContain("exp://*");
  });

  it("always trusts the local Android debug package", () => {
    expect(resolveAuthSecurity(secureInput).trustedOrigins).toContain("com.tabaaq.mobile.debug://");
  });

  it.each([
    ["electronProtocol", "ELECTRON_PROTOCOL", DEFAULT_ELECTRON_PROTOCOL],
    ["mobileProtocol", "MOBILE_PROTOCOL", DEFAULT_MOBILE_PROTOCOL],
  ])("falls back to the default when %s is malformed", (key, setting, fallback) => {
    const resolved = resolveAuthSecurity({ ...secureInput, [key]: "not a scheme" });

    // SAFETY: The parameterized keys are exactly the two protocol properties listed above.
    expect(resolved[key as "electronProtocol" | "mobileProtocol"]).toBe(fallback);
    expect(resolved.rejectedSettings).toEqual([
      { setting, value: "not a scheme", reason: "is not a valid URI scheme" },
    ]);
  });
});

describe("matchesTrustedOrigin", () => {
  it.each([
    ["http://api.example.com", "http://*.example.com", true],
    ["http://api.app.example.com", "http://*.example.com", true],
    ["https://api.example.com", "http://*.example.com", false],
    ["http://example.com", "http://*.example.com", false],
    ["https://api.app.example.com", "https://**.example.com", true],
    ["http://api.example.com", "https://**.example.com", false],
    ["https://example.com", "https://example.com", true],
    ["https://api.example.com", "https://example.com", false],
    ["http://example.com", "https://example.com", false],
    ["exp://192.168.1.100:8081", "exp://192.168.*.*:*", true],
    ["exp://10.0.0.29:8081", "exp://192.168.*.*:*", false],
    ["com.tabaaq.desktop://app", "com.tabaaq.desktop://app", true],
    ["com.tabaaq.mobile://callback", "com.tabaaq.mobile://", true],
    ["com.tabaaq.mobile.debug://app", "com.tabaaq.mobile.debug://", true],
    ["https://evil.example.net", "com.tabaaq.mobile://", false],
  ])("matches %s against %s", (origin, pattern, expected) => {
    expect(isTrustedOrigin(origin, [pattern])).toBe(expected);
  });

  it("matches a bare host pattern against the origin host", () => {
    expect(isTrustedOrigin("https://api.example.com", ["*.example.com"])).toBe(true);
    expect(isTrustedOrigin("https://api.example.com", ["*.other.com"])).toBe(false);
  });
});
