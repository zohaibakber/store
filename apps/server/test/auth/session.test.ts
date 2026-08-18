import type { ClerkVerifyConfig } from "@store/auth";
import { describe, expect, it } from "vitest";

import { clerkVerifyConfigForHeaders } from "../../src/auth/session";

const config: ClerkVerifyConfig = {
  secretKey: "sk_test_example",
  authorizedParties: [
    "https://app.example",
    "com.tabaaq.desktop://app",
    "com.tabaaq.mobile://",
    "com.tabaaq.mobile.debug://",
  ],
};

describe("clerkVerifyConfigForHeaders", () => {
  it("keeps authorized-party verification for browser requests", () => {
    expect(
      clerkVerifyConfigForHeaders(new Headers({ origin: "https://app.example" }), config),
    ).toBe(config);
  });

  it("allows a trusted Expo debug client to use a native token without azp", () => {
    expect(
      clerkVerifyConfigForHeaders(
        new Headers({ "expo-origin": "com.tabaaq.mobile.debug://app" }),
        config,
      ).authorizedParties,
    ).toBeUndefined();
  });

  it("allows the trusted Electron origin after request normalization", () => {
    expect(
      clerkVerifyConfigForHeaders(
        new Headers({
          origin: "com.tabaaq.desktop://app",
          "electron-origin": "com.tabaaq.desktop://app",
        }),
        config,
      ).authorizedParties,
    ).toBeUndefined();
  });

  it("keeps authorized-party verification for an untrusted native origin", () => {
    expect(
      clerkVerifyConfigForHeaders(
        new Headers({ "electron-origin": "com.attacker.desktop://app" }),
        config,
      ),
    ).toBe(config);
  });

  it("does not let a native header override a real browser origin", () => {
    expect(
      clerkVerifyConfigForHeaders(
        new Headers({
          origin: "https://attacker.example",
          "electron-origin": "com.tabaaq.desktop://app",
        }),
        config,
      ),
    ).toBe(config);
  });
});
