import { AccessToken, RefreshToken, TokenSet, sessionEndingCodes } from "@store/auth";
import { decodeAuthenticatedWorkspace, type WorkspaceSnapshot } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadSessionSnapshot } from "../src/session-broker";
import { SessionHttp, layerSessionHttp, sessionFetch } from "../src/session-http";

const API = "https://api.example.test";
const AUTH = "https://auth.example.test";
const REFRESH = `POST ${AUTH}/v1/session/refresh`;
const SESSION = `GET ${API}/api/auth/session`;

const workspace = decodeAuthenticatedWorkspace({
  status: "authenticated",
  user: { id: "user-1", name: "Owner", email: "owner@example.com", image: null },
  activeOrganization: { id: "org-1", name: "Store", role: "owner" },
  organizations: [{ id: "org-1", name: "Store", role: "owner" }],
  isOnline: true,
});

const tokens = (name: string) =>
  TokenSet.make({
    accessToken: AccessToken.make(name),
    accessExpiresAt: Date.now() + 600_000,
    refreshToken: RefreshToken.make(`${name}.secret`),
    refreshExpiresAt: Date.now() + 86_400_000,
  });

type Route = () => Response | Promise<Response>;

const harness = (routes: Readonly<Record<string, Route>>) => {
  const sent: Array<string> = [];
  const outcome = { rejected: 0, forgotten: 0 };
  let local: WorkspaceSnapshot = { ...workspace, isOnline: false };
  const send: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const route = `${request.method} ${request.url}`;
    sent.push(route);
    const respond = routes[route];
    if (respond === undefined) throw new TypeError(`Unexpected request: ${route}`);
    return respond();
  };
  const runtime = ManagedRuntime.make(
    layerSessionHttp({
      apiBaseUrl: API,
      authBaseUrl: AUTH,
      credential: "refreshToken",
      onRefreshed: (refreshed) =>
        Effect.sync(() => {
          local = refreshed.workspace;
        }),
      onRejected: Effect.sync(() => {
        outcome.rejected += 1;
      }),
    }).pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, send)),
    ),
  );
  const seeded = runtime.runPromise(
    SessionHttp.use((session) => session.setTokens(tokens("issued"))),
  );
  const held = () => runtime.runPromise(SessionHttp.use((session) => session.tokens));
  const load = async () => {
    await seeded;
    return runtime.runPromise(
      loadSessionSnapshot({
        getLocalSnapshot: () => local,
        publish: (snapshot) => {
          local = snapshot;
          return snapshot;
        },
        clearAuthenticated: Effect.sync(() => {
          outcome.forgotten += 1;
        }),
      }),
    );
  };
  return { seeded, held, sent, outcome, runtime, load };
};

const denied = () => Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });

const authFailure = (status: number, code: string) => () =>
  Response.json({ error: { code, message: "The session has expired." } }, { status });

const page = (status: number) => () =>
  new Response("<html><body>Sign in to this network</body></html>", {
    status,
    headers: { "content-type": "text/html" },
  });

const survivable: ReadonlyArray<readonly [string, Route]> = [
  ["an HTML 403", page(403)],
  ["an HTML 401", page(401)],
  ["a 401 without our error body", () => Response.json({}, { status: 401 })],
  ["a 401 with a code that does not end a session", authFailure(401, "INVALID_CREDENTIALS")],
  ["a 403 carrying a session-ending code", authFailure(403, "INVALID_REFRESH_TOKEN")],
  ["a 503", authFailure(503, "AUTH_UNAVAILABLE")],
  ["a network failure", () => Promise.reject(new TypeError("fetch failed"))],
  ["a refresh that never answers", () => new Promise<Response>(() => undefined)],
  ["a successful rotation", () => Response.json({ ...tokens("rotated"), workspace })],
];

const elapse = async <A>(pending: Promise<A>) => {
  let settled = false;
  const tracked = pending.finally(() => {
    settled = true;
  });
  while (!settled) await vi.advanceTimersByTimeAsync(1_000);
  return tracked;
};

afterEach(() => {
  vi.useRealTimers();
});

describe("session authority", () => {
  it("only a decoded session-ending refresh failure clears the session", async () => {
    for (const code of sessionEndingCodes) {
      const test = harness({ [SESSION]: denied, [REFRESH]: authFailure(401, code) });

      const snapshot = await test.load();

      expect(snapshot.status, code).toBe("unauthenticated");
      expect(await test.held(), code).toBeNull();
      expect(test.outcome, code).toEqual({ rejected: 1, forgotten: 1 });
      await test.runtime.dispose();
    }

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    for (const [name, respond] of survivable) {
      const test = harness({ [SESSION]: denied, [REFRESH]: respond });

      const snapshot = await elapse(test.load());

      expect(test.sent, name).toContain(REFRESH);
      expect(snapshot.status, name).toBe("authenticated");
      expect((await test.held())?.refreshToken, name).toBeDefined();
      expect(test.outcome, name).toEqual({ rejected: 0, forgotten: 0 });
      await elapse(test.runtime.dispose());
    }
  });

  it("discards a refresh that completes after the session was cleared", async () => {
    let release = (_response: Response) => {};
    const test = harness({
      [REFRESH]: () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    });

    await test.seeded;
    const pending = test.runtime.runPromise(
      SessionHttp.use((session) => session.ensureFreshAccess(true)),
    );
    await vi.waitFor(() => expect(test.sent).toEqual([REFRESH]));
    await test.runtime.runPromise(SessionHttp.use((session) => session.setTokens(null)));
    release(Response.json({ ...tokens("rotated"), workspace }));

    await expect(pending).resolves.toBeNull();
    expect(await test.held()).toBeNull();
  });

  it("refuses every origin but the API before touching the session", async () => {
    const test = harness({});
    const authenticatedFetch = sessionFetch((effect, options) =>
      test.runtime.runPromise(effect, options),
    );

    await expect(authenticatedFetch("https://elsewhere.example.test/x")).rejects.toThrow(TypeError);
    await expect(authenticatedFetch(new URL("/v1/session", AUTH))).rejects.toThrow(TypeError);

    expect(test.sent).toEqual([]);
  });
});
