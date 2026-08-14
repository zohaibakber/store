import { describe, expect, it } from "vitest";

import {
  DEFAULT_ELECTRON_PROTOCOL,
  DEFAULT_MOBILE_PROTOCOL,
  fallbackIfBlank,
  parseTrustedOrigins,
  resolveAuthSecurity,
} from "../src/security";

const secureInput = {
  baseURL: "https://api.example.com",
  electronProtocol: "com.tabaaq.desktop",
  mobileProtocol: "com.tabaaq.mobile",
  secret: "0123456789abcdef".repeat(4),
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
      electronOrigin: "com.tabaaq.desktop:/",
      electronProtocol: "com.tabaaq.desktop",
      mobileOrigin: "com.tabaaq.mobile://",
      mobileProtocol: "com.tabaaq.mobile",
      secureCookies: true,
      trustedOrigins: [
        "https://api.example.com",
        "https://app.example.com",
        "http://localhost:5173",
        "com.tabaaq.desktop:/",
        "com.tabaaq.mobile://",
      ],
    });
  });

  it.each(["short", "a".repeat(64), ` ${"0123456789abcdef".repeat(4)}`])(
    "rejects a weak or malformed secret",
    (secret) => {
      expect(() => resolveAuthSecurity({ ...secureInput, secret })).toThrow("BETTER_AUTH_SECRET");
    },
  );

  it.each([
    "http://api.example.com",
    "https://user:password@app.example.com",
    "https://app.example.com/path",
    "file:///tmp/auth",
  ])("rejects unsafe or non-origin URLs", (origin) => {
    expect(() => resolveAuthSecurity({ ...secureInput, trustedOrigins: [origin] })).toThrow();
  });

  it("allows HTTP only for local development origins", () => {
    const resolved = resolveAuthSecurity({
      ...secureInput,
      baseURL: "http://localhost:8787",
    });
    expect(resolved.secureCookies).toBe(false);
    expect(resolved.trustedOrigins).toContain("exp://*");
  });

  it("does not trust Expo Go origins in production", () => {
    const resolved = resolveAuthSecurity(secureInput);
    expect(resolved.trustedOrigins).not.toContain("exp://*");
  });

  it("rejects malformed Electron protocols", () => {
    expect(() => resolveAuthSecurity({ ...secureInput, electronProtocol: "not a scheme" })).toThrow(
      "ELECTRON_PROTOCOL",
    );
  });

  it("rejects malformed mobile protocols", () => {
    expect(() => resolveAuthSecurity({ ...secureInput, mobileProtocol: "not a scheme" })).toThrow(
      "MOBILE_PROTOCOL",
    );
  });
});
