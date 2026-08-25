import { describe, expect, it } from "vitest";

import { nextRateLimit } from "../src/rate-limit";

const attempt = { key: "identify:user@example.com", limit: 3, windowSeconds: 60, now: 1_000 };

describe("nextRateLimit", () => {
  it("opens a window on the first attempt", () => {
    expect(nextRateLimit(undefined, attempt)).toEqual({ count: 1, expiresAt: 61_000 });
  });

  it("increments inside a live window until the cap", () => {
    expect(nextRateLimit({ count: 1, expiresAt: 61_000 }, attempt)).toEqual({
      count: 2,
      expiresAt: 61_000,
    });
    expect(nextRateLimit({ count: 2, expiresAt: 61_000 }, attempt)).toEqual({
      count: 3,
      expiresAt: 61_000,
    });
    expect(nextRateLimit({ count: 3, expiresAt: 61_000 }, attempt)).toBeNull();
  });

  it("starts a new window when the previous one has expired", () => {
    expect(nextRateLimit({ count: 3, expiresAt: 61_000 }, { ...attempt, now: 61_000 })).toEqual({
      count: 1,
      expiresAt: 121_000,
    });
  });
});
