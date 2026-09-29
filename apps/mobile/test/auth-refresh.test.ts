import { AccessToken, RefreshToken, TokenSet } from "@store/auth";
import { MemoryTokenStore, SessionHttpClient, refreshTokenNeedsRefresh } from "@store/workspace";
import { describe, expect, it } from "vitest";

import { makeAuthenticatedFetch } from "../src/auth/authenticated-fetch";

const API = "https://api.example.test";
const AUTH = "https://auth.example.test";

const expiringTokens = () =>
  TokenSet.make({
    accessToken: AccessToken.make("access-1"),
    accessExpiresAt: Date.now() + 5_000,
    refreshToken: RefreshToken.make("session-1.secret"),
    refreshExpiresAt: Date.now() + 86_400_000,
  });

const harness = () => {
  const tokens = new MemoryTokenStore();
  tokens.set(expiringTokens());
  const sent: Array<string> = [];
  let refreshes = 0;
  const send: typeof fetch = async (input, init) => {
    sent.push(new Request(input, init).url);
    return new Response(null, { status: 200 });
  };
  const http = new SessionHttpClient({
    apiBaseUrl: API,
    authBaseUrl: AUTH,
    tokens,
    fetch: send,
    needsRefresh: refreshTokenNeedsRefresh,
    refreshSession: async () => {
      refreshes += 1;
      return tokens.get();
    },
  });
  return { authenticatedFetch: makeAuthenticatedFetch(http), sent, refreshes: () => refreshes };
};

describe("authenticatedFetch", () => {
  it("refuses every origin but the API before touching the session", async () => {
    const test = harness();

    await expect(test.authenticatedFetch("https://elsewhere.example.test/x")).rejects.toThrow(
      TypeError,
    );
    await expect(test.authenticatedFetch(new URL("/v1/session", AUTH))).rejects.toThrow(TypeError);

    expect(test.sent).toEqual([]);
    expect(test.refreshes()).toBe(0);
  });
});
