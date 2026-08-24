import { AccessToken, RefreshToken } from "@store/auth";
import { describe, expect, it } from "vitest";

import { usableAccessToken } from "../src/lib/auth-tokens";

const tokens = (accessExpiresAt: number) => ({
  accessToken: AccessToken.make("access-token"),
  accessExpiresAt,
  refreshToken: RefreshToken.make("session-1.secret"),
  refreshExpiresAt: accessExpiresAt + 86_400_000,
});

describe("usableAccessToken", () => {
  it("prefers a rotated token set", () => {
    const current = tokens(Date.now() + 1_000);
    const refreshed = {
      ...tokens(Date.now() + 60_000),
      accessToken: AccessToken.make("next-access-token"),
    };
    expect(usableAccessToken(current, refreshed, Date.now())).toBe("next-access-token");
  });

  it("keeps a still-valid access token when refresh fails", () => {
    const current = tokens(Date.now() + 20_000);
    expect(usableAccessToken(current, null, Date.now())).toBe("access-token");
  });

  it("does not keep an expired access token after a failed refresh", () => {
    const current = tokens(Date.now() - 1);
    expect(usableAccessToken(current, null, Date.now())).toBeNull();
  });
});
