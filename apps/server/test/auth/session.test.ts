import type { ClerkVerifyConfig } from "@store/auth";
import { describe, expect, it } from "vitest";

import { clerkVerifyConfigForHeaders } from "../../src/auth/session";

const config: ClerkVerifyConfig = {
  secretKey: "sk_test_example",
  authorizedParties: [
    "https://tabaaq.zohaibakber.com",
    "com.tabaaq.desktop://app",
    "com.tabaaq.mobile://",
  ],
};

describe("clerkVerifyConfigForHeaders", () => {
  it("keeps authorized-party verification for browser requests", () => {
    expect(
      clerkVerifyConfigForHeaders(
        new Headers({ origin: "https://tabaaq.zohaibakber.com" }),
        config,
      ),
    ).toBe(config);
  });

  it("allows a trusted Electron client to use a native token without azp", () => {
    expect(
      clerkVerifyConfigForHeaders(
        new Headers({ "electron-origin": "com.tabaaq.desktop://app" }),
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
