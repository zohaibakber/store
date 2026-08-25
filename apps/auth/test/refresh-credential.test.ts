import { RefreshToken } from "@store/auth";
import { describe, expect, it } from "vitest";

import { resolveRefreshCredential } from "../src/refresh-credential";

const bodyToken = RefreshToken.make("session-body.secret");
const cookieToken = RefreshToken.make("session-cookie.secret");

describe("resolveRefreshCredential", () => {
  it("uses a body token as Native even when a cookie is also present", () => {
    expect(
      resolveRefreshCredential({
        cookie: cookieToken,
        bodyToken,
      }),
    ).toEqual({
      client: { _tag: "Native", deviceName: "Native client" },
      refreshToken: bodyToken,
    });
  });

  it("uses a valid cookie as Browser when the body has no token", () => {
    expect(
      resolveRefreshCredential({
        cookie: cookieToken,
        bodyToken: undefined,
      }),
    ).toEqual({
      client: { _tag: "Browser" },
      refreshToken: cookieToken,
    });
  });

  it("ignores a cookie that is not a refresh token", () => {
    expect(
      resolveRefreshCredential({
        cookie: "",
        bodyToken: undefined,
      }),
    ).toBeUndefined();
  });
});
