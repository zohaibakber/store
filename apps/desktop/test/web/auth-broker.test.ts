import { describe, expect, it } from "vitest";

import { WebAuthBroker } from "../../src/web/auth-broker";
import {
  API,
  AUTH,
  HINT_KEY,
  authenticatedWorkspace,
  browserTokens,
  fakeSessionServer,
  memoryStorage,
  refreshedSession,
} from "./fake-session-server";

const makeBroker = (server: ReturnType<typeof fakeSessionServer>, storage = memoryStorage()) => ({
  storage,
  broker: new WebAuthBroker(
    {
      apiBaseUrl: API,
      authBaseUrl: AUTH,
      fetch: server.fetch,
      storage,
      isOnline: () => true,
    },
    () => undefined,
  ),
});

const expectedSession = () => {
  const storage = memoryStorage();
  storage.setItem(HINT_KEY, "1");
  return storage;
};

describe("WebAuthBroker cold start", () => {
  it("skips the cookie refresh when this origin never signed in", async () => {
    const server = fakeSessionServer({});
    const { broker } = makeBroker(server);

    const snapshot = await broker.initialize();

    expect(server.requests).toEqual([]);
    expect(snapshot).toMatchObject({ status: "unauthenticated", isOnline: true });
  });

  it("refreshes through the cookie and adopts the workspace it carries", async () => {
    const server = fakeSessionServer({
      [`POST ${AUTH}/v1/session/refresh`]: () => refreshedSession(),
    });
    const { broker, storage } = makeBroker(server, expectedSession());

    const snapshot = await broker.initialize();

    expect(server.requests).toEqual([
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: "{}",
        authorization: null,
      }),
    ]);
    expect(snapshot).toMatchObject({
      status: "authenticated",
      isOnline: true,
      activeOrganization: { id: "o1" },
    });
    expect(storage.entries.get(HINT_KEY)).toBe("1");
  });

  it("forgets the session when the refresh cookie is rejected", async () => {
    const server = fakeSessionServer({
      [`POST ${AUTH}/v1/session/refresh`]: () => Response.json({}, { status: 401 }),
    });
    const { broker, storage } = makeBroker(server, expectedSession());

    const snapshot = await broker.initialize();

    expect(snapshot).toMatchObject({ status: "unauthenticated", workspaceError: null });
    expect(storage.entries.has(HINT_KEY)).toBe(false);
  });

  it.each([
    ["a transient refresh failure", Response.json({ message: "Unavailable" }, { status: 503 })],
    ["a malformed refresh response", Response.json({ accessToken: 1 })],
  ])("keeps the session hint through %s", async (_case, response) => {
    const server = fakeSessionServer({
      [`POST ${AUTH}/v1/session/refresh`]: () => response,
    });
    const { broker, storage } = makeBroker(server, expectedSession());

    const snapshot = await broker.initialize();

    expect(snapshot.status).toBe("unauthenticated");
    expect(snapshot.workspaceError).toBeTruthy();
    expect(storage.entries.get(HINT_KEY)).toBe("1");
  });

  it("treats blocked storage as no prior session", async () => {
    const server = fakeSessionServer({});
    const blocked = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    };
    const broker = new WebAuthBroker(
      {
        apiBaseUrl: API,
        authBaseUrl: AUTH,
        fetch: server.fetch,
        storage: blocked,
      },
      () => undefined,
    );

    await expect(broker.initialize()).resolves.toMatchObject({ status: "unauthenticated" });
    expect(server.requests).toEqual([]);
  });
});

describe("WebAuthBroker sign-in and sign-out", () => {
  it("marks the session expected once sign-in tokens are adopted", async () => {
    const server = fakeSessionServer({
      [`GET ${API}/api/auth/session`]: () => Response.json(authenticatedWorkspace),
    });
    const { broker, storage } = makeBroker(server);

    const snapshot = await broker.adoptSession(browserTokens());

    expect(snapshot.status).toBe("authenticated");
    expect(storage.entries.get(HINT_KEY)).toBe("1");
  });

  it("clears the hint when the API does not accept the signed-in session", async () => {
    const server = fakeSessionServer({
      [`GET ${API}/api/auth/session`]: () =>
        Response.json({ message: "This session is not authorized." }, { status: 403 }),
    });
    const { broker, storage } = makeBroker(server);

    const snapshot = await broker.adoptSession(browserTokens());

    expect(snapshot).toMatchObject({
      status: "unauthenticated",
      workspaceError: "This session is not authorized.",
    });
    expect(storage.entries.has(HINT_KEY)).toBe(false);
  });

  it("signs out through the cookie and drops the in-memory access token", async () => {
    const server = fakeSessionServer({
      [`GET ${API}/api/auth/session`]: () => Response.json(authenticatedWorkspace),
      [`POST ${AUTH}/v1/session/logout`]: () => Response.json({ ok: true }),
      [`POST ${AUTH}/v1/session/refresh`]: () => Response.json({}, { status: 401 }),
      [`GET ${API}/api/sync/pull`]: (request) =>
        request.authorization ? Response.json({}) : Response.json({}, { status: 401 }),
    });
    const { broker, storage } = makeBroker(server);
    await broker.adoptSession(browserTokens());

    await broker.signOut();

    expect(server.requests.at(-1)).toMatchObject({
      method: "POST",
      url: `${AUTH}/v1/session/logout`,
      credentials: "include",
      body: "{}",
    });
    expect(broker.snapshot.status).toBe("unauthenticated");
    expect(storage.entries.has(HINT_KEY)).toBe(false);
    const response = await broker.apiFetch("/api/sync/pull");
    expect(response.status).toBe(401);
    expect(server.requests.at(-1)?.authorization).toBeNull();
  });

  it("still signs out locally when the logout request fails", async () => {
    const server = fakeSessionServer({
      [`GET ${API}/api/auth/session`]: () => Response.json(authenticatedWorkspace),
      [`POST ${AUTH}/v1/session/logout`]: () => Promise.reject(new TypeError("offline")),
    });
    const { broker } = makeBroker(server);
    await broker.adoptSession(browserTokens());

    await expect(broker.signOut()).resolves.toBeUndefined();
    expect(broker.snapshot.status).toBe("unauthenticated");
  });
});

describe("WebAuthBroker authenticated fetch", () => {
  it("refreshes through the cookie and retries once when the API rejects the access token", async () => {
    let pulls = 0;
    const server = fakeSessionServer({
      [`GET ${API}/api/auth/session`]: () => Response.json(authenticatedWorkspace),
      [`POST ${AUTH}/v1/session/refresh`]: () => refreshedSession("rotated"),
      [`GET ${API}/api/sync/pull`]: () => {
        pulls += 1;
        return pulls === 1 ? Response.json({}, { status: 401 }) : Response.json({ ok: true });
      },
    });
    const { broker } = makeBroker(server);
    await broker.adoptSession(browserTokens("stale"));

    const response = await broker.apiFetch(`${API}/api/sync/pull`);

    expect(response.status).toBe(200);
    expect(
      server.requests
        .filter((request) => request.url === `${API}/api/sync/pull`)
        .map((request) => request.authorization),
    ).toEqual(["Bearer stale", "Bearer rotated"]);
  });

  it("refuses to attach the access token to another origin", async () => {
    const { broker } = makeBroker(
      fakeSessionServer({
        [`GET ${API}/api/auth/session`]: () => Response.json(authenticatedWorkspace),
      }),
    );
    await broker.adoptSession(browserTokens());
    await expect(broker.apiFetch("https://elsewhere.example/api")).rejects.toThrow(
      "configured API origin",
    );
  });
});
