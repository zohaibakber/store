import { AccessToken, RefreshToken } from "@store/auth";
import { decodeAuthenticatedWorkspace } from "@store/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MemoryTokenStore,
  RefreshedTokenSet,
  RequestError,
  SessionHttpClient,
  cookieSessionNeedsRefresh,
  refreshTokenNeedsRefresh,
  requestErrorFromPayload,
} from "../src/session-http";

const workspace = decodeAuthenticatedWorkspace({
  status: "authenticated",
  user: { id: "user-1", name: "Owner", email: "owner@example.com" },
  activeOrganization: null,
  organizations: [],
  isOnline: true,
});

const tokens = (accessExpiresAt: number) =>
  RefreshedTokenSet.make({
    workspace,
    accessToken: AccessToken.make("access"),
    accessExpiresAt,
    refreshToken: RefreshToken.make("refresh.secret"),
    refreshExpiresAt: accessExpiresAt + 60_000,
  });

describe("session-http helpers", () => {
  it("applies cookie vs refresh-token refresh gates", () => {
    const fresh = tokens(Date.now() + 60_000);
    const stale = tokens(Date.now() + 1_000);
    expect(cookieSessionNeedsRefresh(null, false)).toBe(true);
    expect(cookieSessionNeedsRefresh(fresh, false)).toBe(false);
    expect(cookieSessionNeedsRefresh(fresh, true)).toBe(true);
    expect(refreshTokenNeedsRefresh(stale)).toBe(true);
    expect(refreshTokenNeedsRefresh(fresh)).toBe(false);
    expect(refreshTokenNeedsRefresh(null)).toBe(false);
    expect(refreshTokenNeedsRefresh(fresh, true)).toBe(true);
    expect(refreshTokenNeedsRefresh(null, true)).toBe(false);
  });

  it("parses nested and flat request failures", () => {
    expect(requestErrorFromPayload({ message: "Nope." }, 403)).toMatchObject({
      message: "Nope.",
      status: 403,
    });
    expect(
      requestErrorFromPayload({ error: { code: "FORBIDDEN", message: "Denied." } }, 403),
    ).toMatchObject({
      message: "Denied.",
      status: 403,
      code: "FORBIDDEN",
    });
    expect(requestErrorFromPayload(null, 500)).toMatchObject({
      message: "Request failed (500)",
      status: 500,
    });
  });
});

describe("SessionHttpClient", () => {
  afterEach(() => vi.useRealTimers());

  it("injects the bearer token and parses JSON failures", async () => {
    const store = new MemoryTokenStore();
    store.set(tokens(Date.now() + 60_000));
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ message: "This session is not authorized." }, { status: 403 }),
      );
    const client = new SessionHttpClient({
      apiBaseUrl: "http://localhost:8787/api/",
      authBaseUrl: "http://localhost:8788/",
      tokens: store,
      fetch,
      refreshSession: async () => null,
      needsRefresh: cookieSessionNeedsRefresh,
    });

    await expect(client.apiRequest("/api/auth/session")).rejects.toBeInstanceOf(RequestError);
    expect(client.authBaseUrl).toBe("http://localhost:8788");
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://localhost:8787/api/auth/session");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer access");
  });

  it("coalesces concurrent refreshes", async () => {
    const store = new MemoryTokenStore();
    store.set(tokens(Date.now() + 1_000));
    let refreshes = 0;
    let release!: (value: RefreshedTokenSet) => void;
    const refreshed = new Promise<RefreshedTokenSet>((resolve) => {
      release = resolve;
    });
    const client = new SessionHttpClient({
      apiBaseUrl: "http://localhost:8787",
      authBaseUrl: "http://localhost:8788",
      tokens: store,
      fetch: vi.fn(),
      refreshSession: async () => {
        refreshes += 1;
        const next = await refreshed;
        store.set(next);
        return next;
      },
      needsRefresh: cookieSessionNeedsRefresh,
    });

    const first = client.ensureFreshAccess();
    const second = client.ensureFreshAccess();
    release(tokens(Date.now() + 120_000));
    await Promise.all([first, second]);
    expect(refreshes).toBe(1);
  });

  it("encodes JSON bodies", async () => {
    const store = new MemoryTokenStore();
    store.set(tokens(Date.now() + 60_000));
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    const client = new SessionHttpClient({
      apiBaseUrl: "http://localhost:8787",
      authBaseUrl: "http://localhost:8788",
      tokens: store,
      fetch,
      refreshSession: async () => null,
      needsRefresh: refreshTokenNeedsRefresh,
    });

    await client.apiRequest("/api/organizations", { method: "POST", body: { a: 1 } });
    const [, init] = fetch.mock.calls[0]!;
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(init.body).toBe('{"a":1}');
  });

  it("forces one coalesced refresh and replays once after a 401", async () => {
    const store = new MemoryTokenStore();
    store.set(tokens(Date.now() + 60_000));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ message: "Expired" }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    let refreshes = 0;
    const client = new SessionHttpClient({
      apiBaseUrl: "http://localhost:8787",
      authBaseUrl: "http://localhost:8788",
      tokens: store,
      fetch,
      refreshSession: async () => {
        refreshes += 1;
        const refreshed = RefreshedTokenSet.make({
          ...tokens(Date.now() + 120_000),
          accessToken: AccessToken.make("refreshed"),
        });
        store.set(refreshed);
        return refreshed;
      },
      needsRefresh: refreshTokenNeedsRefresh,
    });

    await expect(client.apiRequest("/api/auth/session")).resolves.toEqual({ ok: true });

    expect(refreshes).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new Headers(fetch.mock.calls[1]![1].headers).get("authorization")).toBe(
      "Bearer refreshed",
    );
  });

  it("does not recursively replay when refresh is explicitly rejected", async () => {
    const store = new MemoryTokenStore();
    store.set(tokens(Date.now() + 60_000));
    const fetch = vi.fn().mockResolvedValue(Response.json({ message: "Expired" }, { status: 401 }));
    const client = new SessionHttpClient({
      apiBaseUrl: "http://localhost:8787",
      authBaseUrl: "http://localhost:8788",
      tokens: store,
      fetch,
      refreshSession: async () => null,
      needsRefresh: refreshTokenNeedsRefresh,
    });

    await expect(client.apiRequest("/api/auth/session")).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects malformed successful JSON at the HTTP boundary", async () => {
    const store = new MemoryTokenStore();
    store.set(tokens(Date.now() + 60_000));
    const client = new SessionHttpClient({
      apiBaseUrl: "http://localhost:8787",
      authBaseUrl: "http://localhost:8788",
      tokens: store,
      fetch: vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })),
      refreshSession: async () => null,
      needsRefresh: refreshTokenNeedsRefresh,
    });

    await expect(client.apiRequest("/api/auth/session")).rejects.toMatchObject({
      status: 200,
      code: "INVALID_JSON_RESPONSE",
    });
  });
});
