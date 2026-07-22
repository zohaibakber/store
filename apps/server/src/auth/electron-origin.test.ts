import { describe, expect, it } from "vitest";
import { withElectronOrigin } from "./electron-origin";

describe("withElectronOrigin", () => {
  it("replaces a null Origin with the API origin for a verified Electron request", () => {
    const request = new Request("https://api.example.com/api/auth/sign-in/email", {
      headers: { origin: "null", "electron-origin": "com.tabaaq.desktop:/" },
      method: "POST",
    });

    expect(withElectronOrigin(request, "com.tabaaq.desktop").headers.get("origin")).toBe(
      "https://api.example.com",
    );
  });

  it("adds the API origin when Origin is missing from a verified Electron request", () => {
    const request = new Request("https://api.example.com/api/auth/get-session", {
      headers: { "electron-origin": "com.tabaaq.desktop:/" },
    });

    expect(withElectronOrigin(request, "com.tabaaq.desktop").headers.get("origin")).toBe(
      "https://api.example.com",
    );
  });

  it("preserves a real browser Origin", () => {
    const request = new Request("https://api.example.com/api/auth/get-session", {
      headers: {
        origin: "https://app.example.com",
        "electron-origin": "com.tabaaq.desktop:/",
      },
    });

    expect(withElectronOrigin(request, "com.tabaaq.desktop")).toBe(request);
  });

  it("does not trust a different Electron protocol", () => {
    const request = new Request("https://api.example.com/api/auth/get-session", {
      headers: { origin: "null", "electron-origin": "com.attacker.app:/" },
    });

    expect(withElectronOrigin(request, "com.tabaaq.desktop")).toBe(request);
  });
});
