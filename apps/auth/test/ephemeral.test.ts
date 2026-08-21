import { describe, expect, it } from "vitest";

import { kvExpirationTtlSeconds } from "../src/ephemeral";

describe("kvExpirationTtlSeconds", () => {
  it("keeps Cloudflare KV above the 60-second minimum for a 60-second window", () => {
    const now = 1_710_000_060;
    const expiresAt = now + 60_000;
    expect(kvExpirationTtlSeconds(expiresAt, now)).toBeGreaterThanOrEqual(61);
  });

  it("does not shrink a longer window", () => {
    const now = 1_000;
    expect(kvExpirationTtlSeconds(now + 3_600_000, now)).toBe(3_601);
  });
});
