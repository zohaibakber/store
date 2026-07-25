import { describe, expect, it } from "vitest";

import { normalizeElectronOrigin } from "../../src/auth/electron-origin";

describe("normalizeElectronOrigin", () => {
  it("removes a null Origin so the verified Electron plugin can supply its scheme", () => {
    const request = new Request("https://api.example.com/api/auth/sign-in/email", {
      headers: { origin: "null", "electron-origin": "com.tabaaq.desktop:/" },
      method: "POST",
    });

    expect(normalizeElectronOrigin(request, "com.tabaaq.desktop").headers.get("origin")).toBeNull();
  });

  it("clones a verified request so the Electron plugin can set Origin", () => {
    const request = new Request("https://api.example.com/api/auth/get-session", {
      headers: { "electron-origin": "com.tabaaq.desktop:/" },
    });
    const normalized = normalizeElectronOrigin(request, "com.tabaaq.desktop");

    expect(normalized).not.toBe(request);
    expect(() => normalized.headers.set("origin", "com.tabaaq.desktop:/")).not.toThrow();
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
