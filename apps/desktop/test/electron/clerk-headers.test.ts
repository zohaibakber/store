import { describe, expect, it } from "vitest";

import {
  nativeClerkRequestHeaders,
  nativeClerkResponseHeaders,
} from "../../electron/clerk-headers";

describe("nativeClerkRequestHeaders", () => {
  const clerkHostname = "destined-camel.clerk.accounts.dev";

  it("removes Chromium's Origin from authorized Clerk native requests", () => {
    expect(
      nativeClerkRequestHeaders(
        `https://${clerkHostname}/v1/client?_is_native=1`,
        {
          Authorization: "Bearer client-jwt",
          Origin: "com.tabaaq.desktop://app",
          Accept: "application/json",
        },
        clerkHostname,
      ),
    ).toEqual({ Authorization: "Bearer client-jwt", Accept: "application/json" });
  });

  it("matches header names case-insensitively", () => {
    expect(
      nativeClerkRequestHeaders(
        `https://${clerkHostname}/v1/environment`,
        { authorization: "Bearer client-jwt", origin: "com.tabaaq.desktop://app" },
        clerkHostname,
      ),
    ).toEqual({ authorization: "Bearer client-jwt" });
  });

  it("does not change API requests or unsigned Clerk requests", () => {
    const apiHeaders = {
      Authorization: "Bearer session-jwt",
      Origin: "com.tabaaq.desktop://app",
    };
    expect(
      nativeClerkRequestHeaders("https://api.example.com/api/sync", apiHeaders, clerkHostname),
    ).toBe(apiHeaders);

    const unsigned = { Origin: "com.tabaaq.desktop://app" };
    expect(
      nativeClerkRequestHeaders(`https://${clerkHostname}/v1/environment`, unsigned, clerkHostname),
    ).toBe(unsigned);
  });

  it("exposes native Clerk responses only to the desktop renderer", () => {
    const headers = { "Content-Type": ["application/json"] };
    expect(
      nativeClerkResponseHeaders(
        `https://${clerkHostname}/v1/client`,
        headers,
        clerkHostname,
        "com.tabaaq.desktop://app",
      ),
    ).toEqual({
      "Content-Type": ["application/json"],
      "Access-Control-Allow-Origin": ["com.tabaaq.desktop://app"],
    });
    expect(
      nativeClerkResponseHeaders(
        "https://api.example.com/api/session",
        headers,
        clerkHostname,
        "com.tabaaq.desktop://app",
      ),
    ).toBe(headers);

    const publicHeaders = { "access-control-allow-origin": ["*"] };
    expect(
      nativeClerkResponseHeaders(
        `https://${clerkHostname}/npm/@clerk/ui@1/dist/ui.browser.js`,
        publicHeaders,
        clerkHostname,
        "com.tabaaq.desktop://app",
      ),
    ).toBe(publicHeaders);
  });
});
