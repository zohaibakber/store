import { describe, expect, it } from "vitest";

import { resolveAuthSecurity } from "../src/security";

const secureInput = {
  baseURL: "https://api.example.com",
  electronProtocol: "com.tabaaq.desktop",
  secret: "0123456789abcdef".repeat(4),
  trustedOrigins: ["https://app.example.com"],
} as const;

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
      secureCookies: true,
      trustedOrigins: [
        "https://api.example.com",
        "https://app.example.com",
        "http://localhost:5173",
        "com.tabaaq.desktop:/",
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
  });

  it("rejects malformed Electron protocols", () => {
    expect(() => resolveAuthSecurity({ ...secureInput, electronProtocol: "not a scheme" })).toThrow(
      "ELECTRON_PROTOCOL",
    );
  });
});
