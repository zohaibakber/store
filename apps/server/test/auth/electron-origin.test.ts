import { describe, expect, it } from "vitest";

import { normalizeElectronOrigin } from "../../src/auth/electron-origin";

describe("normalizeElectronOrigin", () => {
  it("sets Origin from a verified electron-origin when Origin is missing", () => {
    const request = new Request("https://api.example.com/api/auth/sign-in/email", {
      headers: { "electron-origin": "com.tabaaq.desktop:/" },
      method: "POST",
    });
    const normalized = normalizeElectronOrigin(request, "com.tabaaq.desktop");

    expect(normalized).not.toBe(request);
    expect(normalized.headers.get("origin")).toBe("com.tabaaq.desktop:/");
  });

  it("replaces Electron's opaque null Origin with the verified scheme", () => {
    const request = new Request("https://api.example.com/api/auth/sign-in/email", {
      headers: { origin: "null", "electron-origin": "com.tabaaq.desktop:/" },
      method: "POST",
    });

    expect(normalizeElectronOrigin(request, "com.tabaaq.desktop").headers.get("origin")).toBe(
      "com.tabaaq.desktop:/",
    );
  });

  it("preserves a real browser Origin", () => {
    const request = new Request("https://api.example.com/api/auth/get-session", {
      headers: {
        origin: "https://app.example.com",
        "electron-origin": "com.tabaaq.desktop:/",
      },
    });

    expect(normalizeElectronOrigin(request, "com.tabaaq.desktop")).toBe(request);
  });

  it("does not trust a different Electron protocol", () => {
    const request = new Request("https://api.example.com/api/auth/get-session", {
      headers: { origin: "null", "electron-origin": "com.attacker.app:/" },
    });

    expect(normalizeElectronOrigin(request, "com.tabaaq.desktop")).toBe(request);
  });
});
