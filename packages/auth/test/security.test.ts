import { describe, expect, it } from "vitest";

import { isTrustedOrigin, isTrustedRedirect, resolveAuthSecurity } from "../src/security";

const secureInput = {
  baseURL: "https://api.example.com",
  electronProtocol: "com.tabaaq.desktop",
  mobileProtocol: "com.tabaaq.mobile",
  trustedOrigins: ["https://app.example.com"],
} as const;

describe("resolveAuthSecurity", () => {
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

  it("does not mistake a hostname beginning with 127 for a loopback address", () => {
    const resolved = resolveAuthSecurity({
      ...secureInput,
      baseURL: "http://localhost:8787",
      trustedOrigins: ["http://127.evil.example:5173"],
    });

    expect(resolved.rejectedSettings.map((rejected) => rejected.value)).toEqual([
      "http://127.evil.example:5173",
    ]);
    expect(resolved.trustedOrigins).not.toContain("http://127.evil.example:5173");
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
    ["com.tabaaq.desktop://app", "com.tabaaq.desktop://app", true],
    ["com.tabaaq.mobile://callback", "com.tabaaq.mobile://", true],
    ["com.tabaaq.mobile.debug://app", "com.tabaaq.mobile.debug://", true],
    ["https://evil.example.net", "com.tabaaq.mobile://", false],
    ["https://api.example.com", "*.example.com", true],
    ["https://api.example.com", "*.other.com", false],
  ])("matches %s against %s", (origin, pattern, expected) => {
    expect(isTrustedOrigin(origin, [pattern])).toBe(expected);
  });
});

describe("isTrustedRedirect", () => {
  const redirects = resolveAuthSecurity(secureInput).trustedRedirects;

  it.each([
    ["https://app.example.com/auth/callback", true],
    ["https://api.example.com/auth/callback", true],
    ["https://evil.example.net/auth/callback", false],
    ["com.tabaaq.desktop://auth/callback", true],
    ["com.tabaaq.mobile://auth/callback", true],
    ["com.tabaaq.other://auth/callback", false],
    ["not a url", false],
  ])("decides %s", (redirectUri, expected) => {
    expect(isTrustedRedirect(redirectUri, redirects)).toBe(expected);
  });
});
