import { AccessToken, RefreshToken, TokenSet } from "@store/auth";
import { MemoryTokenStore, SessionHttpClient, refreshTokenNeedsRefresh } from "@store/workspace";
import { describe, expect, it } from "vitest";

import { makeAuthenticatedFetch } from "../src/auth/authenticated-fetch";

const API = "https://api.example.test";
const AUTH = "https://auth.example.test";
const MINUTE = 60_000;

const tokenSet = (generation: number, expiresIn = 10 * MINUTE) =>
  TokenSet.make({
    accessToken: AccessToken.make(`access-${generation}`),
    accessExpiresAt: Date.now() + expiresIn,
    refreshToken: RefreshToken.make(`session-${generation}.secret`),
    refreshExpiresAt: Date.now() + 30 * 24 * 60 * MINUTE,
  });

type Harness = {
  readonly authenticatedFetch: typeof fetch;
  readonly tokens: MemoryTokenStore;
  readonly sent: Array<string | null>;
  readonly refreshes: () => number;
  readonly releaseRefresh: () => void;
  readonly acceptOnly: (accessToken: string | null) => void;
  readonly rejectEverything: () => void;
};

const harness = (options: {
  readonly initial: TokenSet;
  readonly refreshResult?: "rotate" | "reject";
  readonly holdRefresh?: boolean;
}): Harness => {
  const tokens = new MemoryTokenStore();
  tokens.set(options.initial);
  const sent: Array<string | null> = [];
  let accepted: string | null = `Bearer ${options.initial.accessToken}`;
  let refreshes = 0;
  let rejectAll = false;
  const gate = Promise.withResolvers<void>();
  if (options.holdRefresh !== true) gate.resolve();

  const send: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const authorization = request.headers.get("authorization");
    sent.push(authorization);
    return new Response(null, { status: !rejectAll && authorization === accepted ? 200 : 401 });
  };

  const http = new SessionHttpClient({
    apiBaseUrl: API,
    authBaseUrl: AUTH,
    tokens,
    fetch: send,
    needsRefresh: refreshTokenNeedsRefresh,
    refreshSession: async () => {
      refreshes += 1;
      await gate.promise;
      if (options.refreshResult === "reject") {
        tokens.set(null);
        return null;
      }
      const next = tokenSet(refreshes + 1);
      tokens.set(next);
      accepted = `Bearer ${next.accessToken}`;
      return next;
    },
  });

  return {
    authenticatedFetch: makeAuthenticatedFetch({ http, fetch: send }),
    tokens,
    sent,
    refreshes: () => refreshes,
    releaseRefresh: () => gate.resolve(),
    acceptOnly: (accessToken) => {
      accepted = accessToken === null ? null : `Bearer ${accessToken}`;
    },
    rejectEverything: () => {
      rejectAll = true;
    },
  };
};

describe("authenticatedFetch", () => {
  it("adds the bearer token and resolves paths against the API", async () => {
    const test = harness({ initial: tokenSet(1) });

    const response = await test.authenticatedFetch("/api/sync/pull", { method: "POST" });

    expect(response.status).toBe(200);
    expect(test.sent).toEqual(["Bearer access-1"]);
    expect(test.refreshes()).toBe(0);
  });

  it("shares one refresh between concurrent requests that hit 401", async () => {
    const test = harness({ initial: tokenSet(1), holdRefresh: true });
    test.acceptOnly(null);

    const requests = Promise.all([
      test.authenticatedFetch(`${API}/api/a`),
      test.authenticatedFetch(`${API}/api/b`),
      test.authenticatedFetch(`${API}/api/c`),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    test.releaseRefresh();
    const responses = await requests;

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(test.refreshes()).toBe(1);
    expect(test.sent.filter((value) => value === "Bearer access-2")).toHaveLength(3);
  });

  it("retries a stale 401 with the newer token without refreshing again", async () => {
    const test = harness({ initial: tokenSet(1) });
    test.acceptOnly(null);
    await test.authenticatedFetch(`${API}/api/first`);
    expect(test.refreshes()).toBe(1);

    test.tokens.set(tokenSet(1));
    const staleSend = test.authenticatedFetch(`${API}/api/second`);
    test.tokens.set(tokenSet(7));
    test.acceptOnly("access-7");
    const response = await staleSend;

    expect(response.status).toBe(200);
    expect(test.refreshes()).toBe(1);
  });

  it("retries exactly once and returns the second 401", async () => {
    const test = harness({ initial: tokenSet(1) });
    test.acceptOnly(null);
    const response = await test.authenticatedFetch(`${API}/api/x`);
    expect(response.status).toBe(200);

    test.rejectEverything();
    const rejected = await test.authenticatedFetch(`${API}/api/y`);

    expect(rejected.status).toBe(401);
    expect(test.refreshes()).toBe(2);
    expect(test.sent.slice(-2)).toEqual(["Bearer access-2", "Bearer access-3"]);
  });

  it("returns the 401 when the refresh is rejected", async () => {
    const test = harness({ initial: tokenSet(1), refreshResult: "reject" });
    test.acceptOnly(null);

    const response = await test.authenticatedFetch(`${API}/api/x`);

    expect(response.status).toBe(401);
    expect(test.refreshes()).toBe(1);
    expect(test.sent).toEqual(["Bearer access-1"]);
  });

  it("refreshes an access token that is about to expire before sending", async () => {
    const test = harness({ initial: tokenSet(1, 5_000) });
    test.acceptOnly("access-2");

    const response = await test.authenticatedFetch(`${API}/api/x`);

    expect(response.status).toBe(200);
    expect(test.refreshes()).toBe(1);
    expect(test.sent).toEqual(["Bearer access-2"]);
  });

  it("refuses to send the token to another origin", async () => {
    const test = harness({ initial: tokenSet(1) });

    await expect(test.authenticatedFetch("https://elsewhere.example.test/x")).rejects.toThrow(
      TypeError,
    );
    expect(test.sent).toEqual([]);
  });
});
