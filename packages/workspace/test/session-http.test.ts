import { describe, expect, it } from "@effect/vitest";
import { AccessToken, RefreshToken, TokenSet, sessionEndingCodes } from "@store/auth";
import { decodeAuthenticatedWorkspace, type WorkspaceSnapshot } from "@store/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";

import { loadSessionSnapshot } from "../src/session-broker";
import { SessionHttp, layerSessionHttp } from "../src/session-http";

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

const NOW = Date.UTC(2026, 9, 5);

const tokens = (name: string) =>
  TokenSet.make({
    accessToken: AccessToken.make(name),
    accessExpiresAt: NOW + 600_000,
    refreshToken: RefreshToken.make(`${name}.secret`),
    refreshExpiresAt: NOW + 86_400_000,
  });

type Route = () => Response | Promise<Response>;

const harness = (routes: Readonly<Record<string, Route>>) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const sent: Array<string> = [];
    const outcome = { rejected: 0, forgotten: 0 };
    let local: WorkspaceSnapshot = { ...workspace, isOnline: false };
    let refreshSeen = () => {};
    const refreshRequested = new Promise<void>((resolve) => {
      refreshSeen = resolve;
    });
    const send: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      const route = `${request.method} ${request.url}`;
      sent.push(route);
      if (route === REFRESH) refreshSeen();
      const respond = routes[route];
      if (respond === undefined) throw new TypeError(`Unexpected request: ${route}`);
      return respond();
    };
    const context = yield* Layer.build(
      layerSessionHttp({
        apiBaseUrl: API,
        authBaseUrl: AUTH,
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
    const session = Context.get(context, SessionHttp);
    yield* session.setTokens(tokens("issued"));
    const load = loadSessionSnapshot({
      getLocalSnapshot: () => local,
      publish: (snapshot) => {
        local = snapshot;
        return snapshot;
      },
      clearAuthenticated: Effect.sync(() => {
        outcome.forgotten += 1;
      }),
    }).pipe(Effect.provideService(SessionHttp, session));
    return {
      session,
      held: session.tokens,
      sent,
      outcome,
      load,
      refreshRequested: Effect.promise(() => refreshRequested),
    };
  });

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

describe("session authority", () => {
  it.effect.each([...sessionEndingCodes])(
    "a decoded session-ending refresh failure (%s) clears the session",
    (code) =>
      Effect.gen(function* () {
        const test = yield* harness({ [SESSION]: denied, [REFRESH]: authFailure(401, code) });

        const snapshot = yield* test.load;

        expect(snapshot.status).toBe("unauthenticated");
        expect(yield* test.held).toBeNull();
        expect(test.outcome).toEqual({ rejected: 1, forgotten: 1 });
      }),
  );

  it.effect.each(survivable)("keeps the session through %s", ([, respond]) =>
    Effect.gen(function* () {
      const test = yield* harness({ [SESSION]: denied, [REFRESH]: respond });

      const loading = yield* Effect.forkChild(test.load);
      yield* test.refreshRequested;
      yield* TestClock.adjust("30 seconds");
      const snapshot = yield* Fiber.join(loading);

      expect(test.sent).toContain(REFRESH);
      expect(snapshot.status).toBe("authenticated");
      expect((yield* test.held)?.refreshToken).toBeDefined();
      expect(test.outcome).toEqual({ rejected: 0, forgotten: 0 });
    }),
  );

  it.effect("discards a refresh that completes after the session was cleared", () =>
    Effect.gen(function* () {
      let release = (_response: Response) => {};
      const test = yield* harness({
        [REFRESH]: () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      });

      const pending = yield* Effect.forkChild(test.session.ensureFreshAccess(true));
      yield* test.refreshRequested;
      yield* test.session.setTokens(null);
      release(Response.json({ ...tokens("rotated"), workspace }));

      expect(yield* Fiber.join(pending)).toBeNull();
      expect(yield* test.held).toBeNull();
    }),
  );
});
