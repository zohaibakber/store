import { describe, expect, it } from "vitest";

import { publicServiceUrl } from "../app.config";

const productionUrl = (value: string | undefined) =>
  publicServiceUrl({ environmentName: "EXPO_PUBLIC_API_URL", isProduction: true, value });

describe("publicServiceUrl", () => {
  it("requires an HTTPS URL in production", () => {
    expect(() => productionUrl(undefined)).toThrow("required");
    expect(() => productionUrl("http://api.example")).toThrow("HTTPS");
    expect(productionUrl(" https://api.example/api ")).toBe("https://api.example/api");
  });

  it("rejects credentials and non-web protocols", () => {
    expect(() => productionUrl("https://user:secret@api.example")).toThrow("credentials");
    expect(() => productionUrl("file:///tmp/api")).toThrow("HTTPS");
  });

  it("allows a missing or local HTTP URL outside production", () => {
    expect(
      publicServiceUrl({
        environmentName: "EXPO_PUBLIC_API_URL",
        isProduction: false,
        value: undefined,
      }),
    ).toBeUndefined();
    expect(
      publicServiceUrl({
        environmentName: "EXPO_PUBLIC_API_URL",
        isProduction: false,
        value: "http://localhost:8787",
      }),
    ).toBe("http://localhost:8787");
  });
});
