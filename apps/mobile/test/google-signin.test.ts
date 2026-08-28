import { describe, expect, it } from "vitest";

import { GOOGLE_SIGN_IN_MISCONFIGURED, isGoogleDeveloperError } from "../src/lib/google-signin";

describe("isGoogleDeveloperError", () => {
  it("recognizes Play services developer-error codes", () => {
    expect(isGoogleDeveloperError({ code: "10" })).toBe(true);
    expect(isGoogleDeveloperError({ code: 10 })).toBe(true);
    expect(isGoogleDeveloperError({ code: "DEVELOPER_ERROR" })).toBe(true);
    expect(GOOGLE_SIGN_IN_MISCONFIGURED).toContain("SHA-1");
  });

  it("ignores cancel and unrelated failures", () => {
    expect(isGoogleDeveloperError({ code: "SIGN_IN_CANCELLED" })).toBe(false);
    expect(isGoogleDeveloperError(new Error("network"))).toBe(false);
  });
});
