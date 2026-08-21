// @vitest-environment happy-dom
import { AccessToken, RefreshToken, TokenSet } from "@store/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebAuthBroker } from "../src/auth";

const tokens = TokenSet.make({
  accessToken: AccessToken.make("access-token"),
  accessExpiresAt: Date.now() + 60_000,
  refreshToken: RefreshToken.make("session.secret"),
  refreshExpiresAt: Date.now() + 120_000,
});

const SESSION_EXPECTED_KEY = "tabaaq-web-session-expected";

const memoryStorage = (): Storage => {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
};

describe("WebAuthBroker", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts unauthenticated before the first session lookup", () => {
    const auth = new WebAuthBroker("http://localhost:8787", "http://localhost:8788");
    expect(auth.snapshot).toMatchObject({
      status: "unauthenticated",
      user: null,
      activeOrganization: null,
      isOnline: false,
    });
  });

  it("skips cookie refresh on cold start when no session is expected", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const auth = new WebAuthBroker("http://localhost:8787", "http://localhost:8788");

    const snapshot = await auth.initialize();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(snapshot).toMatchObject({ status: "unauthenticated" });
  });

  it("forces cookie refresh when a prior session is expected", async () => {
    localStorage.setItem(SESSION_EXPECTED_KEY, "1");
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const auth = new WebAuthBroker("http://localhost:8787", "http://localhost:8788");

    const snapshot = await auth.initialize();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8788/v1/session/refresh",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(snapshot).toMatchObject({ status: "unauthenticated" });
    expect(localStorage.getItem(SESSION_EXPECTED_KEY)).toBeNull();
  });

  it("marks a session expected after adoptSession receives tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          status: "unauthenticated",
          user: null,
          activeOrganization: null,
          organizations: [],
          isOnline: true,
        }),
      ),
    );
    const auth = new WebAuthBroker("http://localhost:8787", "http://localhost:8788");

    await auth.adoptSession(tokens);

    expect(localStorage.getItem(SESSION_EXPECTED_KEY)).toBe("1");
  });

  it("reports when an access token is not accepted as an authenticated session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          status: "unauthenticated",
          user: null,
          activeOrganization: null,
          organizations: [],
          isOnline: true,
        }),
      ),
    );
    const auth = new WebAuthBroker("http://localhost:8787", "http://localhost:8788");

    const snapshot = await auth.adoptSession(tokens);

    expect(snapshot).toMatchObject({
      status: "unauthenticated",
      workspaceError: "You signed in, but the server rejected the session.",
    });
  });

  it("keeps session request errors in the workspace snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ message: "This session is not authorized." }, { status: 403 }),
        ),
    );
    const auth = new WebAuthBroker("http://localhost:8787", "http://localhost:8788");

    const snapshot = await auth.adoptSession(tokens);

    expect(snapshot).toMatchObject({
      status: "unauthenticated",
      isOnline: true,
      workspaceError: "This session is not authorized.",
    });
  });
});
