import { AccessToken, InvitationToken, RefreshToken, TokenSet } from "@store/auth";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { describe, expect, it } from "vitest";

import {
  MemoryTokenStore,
  RequestError,
  SessionHttp,
  cookieSessionNeedsRefresh,
  layerSessionHttp,
  refreshTokenNeedsRefresh,
  requestErrorFromPayload,
  type SessionCredential,
  type SessionHttpApi,
} from "../src/session-http";

const API = "http://localhost:8787";
const AUTH = "http://localhost:8788";

const workspace = {
  status: "authenticated",
  user: { id: "user-1", name: "Owner", email: "owner@example.com", image: null },
  activeOrganization: { id: "org-1", name: "Store", slug: null, role: "owner" },
  organizations: [{ id: "org-1", name: "Store", slug: null, role: "owner" }],
  isOnline: true,
};

const tokens = (accessToken: string, accessExpiresAt: number) =>
  TokenSet.make({
    accessToken: AccessToken.make(accessToken),
    accessExpiresAt,
    refreshToken: RefreshToken.make(`${accessToken}.secret`),
    refreshExpiresAt: accessExpiresAt + 60_000,
  });

const refreshed = (accessToken: string) =>
  Response.json({ ...tokens(accessToken, Date.now() + 120_000), workspace });

type Sent = {
  readonly route: string;
  readonly authorization: string | null;
  readonly body: string;
};

const upstream = (routes: Record<string, (sent: Sent) => Response | Promise<Response>>) => {
  const sent: Array<Sent> = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const record = {
      route: `${request.method} ${url.origin}${url.pathname}`,
      authorization: request.headers.get("authorization"),
      body: await request.text(),
    };
    sent.push(record);
    const route = routes[record.route];
    if (!route) throw new TypeError(`Unexpected request: ${record.route}`);
    return route(record);
  };
  return { fetch, sent, count: (route: string) => sent.filter((s) => s.route === route).length };
};

const session = (
  server: ReturnType<typeof upstream>,
  options: {
    readonly credential?: SessionCredential;
    readonly initial?: TokenSet | null;
    readonly apiBaseUrl?: string;
    readonly authBaseUrl?: string;
    readonly rejected?: () => void;
  } = {},
) => {
  const store = new MemoryTokenStore();
  store.set(options.initial ?? null);
  const runtime = ManagedRuntime.make(
    layerSessionHttp({
      apiBaseUrl: options.apiBaseUrl ?? API,
      authBaseUrl: options.authBaseUrl ?? AUTH,
      tokens: store,
      credential: options.credential ?? "refreshToken",
      onRefreshed: () => Effect.void,
      onRejected: Effect.sync(() => options.rejected?.()),
    }).pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, server.fetch)),
    ),
  );
  const use = <A, E>(f: (session: SessionHttpApi) => Effect.Effect<A, E>) =>
    runtime.runPromise(SessionHttp.use(f));
  return { store, runtime, use };
};

describe("session-http helpers", () => {
  it("applies cookie vs refresh-token refresh gates", () => {
    const now = Date.now();
    const fresh = tokens("access", now + 60_000);
    const stale = tokens("access", now + 1_000);
    expect(cookieSessionNeedsRefresh(null, false, now)).toBe(true);
    expect(cookieSessionNeedsRefresh(fresh, false, now)).toBe(false);
    expect(cookieSessionNeedsRefresh(fresh, true, now)).toBe(true);
    expect(refreshTokenNeedsRefresh(stale, false, now)).toBe(true);
    expect(refreshTokenNeedsRefresh(fresh, false, now)).toBe(false);
    expect(refreshTokenNeedsRefresh(null, false, now)).toBe(false);
    expect(refreshTokenNeedsRefresh(fresh, true, now)).toBe(true);
    expect(refreshTokenNeedsRefresh(null, true, now)).toBe(false);
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

describe("SessionHttp", () => {
  it("injects the bearer token and parses JSON failures", async () => {
    const server = upstream({
      [`GET ${API}/api/auth/session`]: () =>
        Response.json({ message: "This session is not authorized." }, { status: 403 }),
    });
    const client = session(server, {
      credential: "cookie",
      initial: tokens("access", Date.now() + 60_000),
      apiBaseUrl: `${API}/api/`,
      authBaseUrl: `${AUTH}/`,
    });

    await expect(client.use((s) => s.workspace)).rejects.toBeInstanceOf(RequestError);
    await expect(client.use((s) => Effect.succeed(s.authBaseUrl))).resolves.toBe(AUTH);
    expect(server.sent).toEqual([
      { route: `GET ${API}/api/auth/session`, authorization: "Bearer access", body: "" },
    ]);
  });

  it("coalesces concurrent refreshes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = upstream({
      [`POST ${AUTH}/v1/session/refresh`]: async () => {
        await gate;
        return refreshed("next");
      },
    });
    const client = session(server, { initial: tokens("access", Date.now() + 1_000) });

    const first = client.use((s) => s.ensureFreshAccess());
    const second = client.use((s) => s.ensureFreshAccess());
    await new Promise((resolve) => setTimeout(resolve, 5));
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(server.count(`POST ${AUTH}/v1/session/refresh`)).toBe(1);
    expect(a?.accessToken).toBe("next");
    expect(b?.accessToken).toBe("next");
    expect(client.store.get()?.accessToken).toBe("next");
  });

  it("sends typed organization commands as JSON with the bearer token", async () => {
    const server = upstream({
      [`POST ${AUTH}/v1/organization`]: () =>
        Response.json({
          _tag: "Joined",
          organization: { id: "org-2", name: "Other", slug: null, role: "member" },
        }),
    });
    const client = session(server, { initial: tokens("access", Date.now() + 60_000) });

    const result = await client.use((s) =>
      s.organize({ _tag: "AcceptInvitation", token: InvitationToken.make("invite-token") }),
    );

    expect(result).toMatchObject({ _tag: "Joined", organization: { id: "org-2" } });
    expect(server.sent).toEqual([
      {
        route: `POST ${AUTH}/v1/organization`,
        authorization: "Bearer access",
        body: '{"_tag":"AcceptInvitation","token":"invite-token"}',
      },
    ]);
  });

  it("forces one coalesced refresh and replays once after a 401", async () => {
    const server = upstream({
      [`POST ${AUTH}/v1/session/refresh`]: () => refreshed("refreshed"),
      [`GET ${API}/api/auth/session`]: (sent) =>
        sent.authorization === "Bearer refreshed"
          ? Response.json(workspace)
          : Response.json({ message: "Expired" }, { status: 401 }),
    });
    const client = session(server, { initial: tokens("access", Date.now() + 60_000) });

    await expect(client.use((s) => s.workspace)).resolves.toMatchObject({
      status: "authenticated",
    });

    expect(server.sent.map((s) => [s.route, s.authorization])).toEqual([
      [`GET ${API}/api/auth/session`, "Bearer access"],
      [`POST ${AUTH}/v1/session/refresh`, null],
      [`GET ${API}/api/auth/session`, "Bearer refreshed"],
    ]);
  });

  it("replays late 401s from the prior token without another rotation", async () => {
    let delay = 0;
    const server = upstream({
      [`POST ${AUTH}/v1/session/refresh`]: () => refreshed("next"),
      [`GET ${API}/api/auth/session`]: async (sent) => {
        if (sent.authorization === "Bearer next") return Response.json(workspace);
        delay += 10;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return Response.json({ message: "Expired" }, { status: 401 });
      },
    });
    const client = session(server, { initial: tokens("access", Date.now() + 60_000) });

    await Promise.all(Array.from({ length: 3 }, () => client.use((s) => s.workspace)));

    expect(server.count(`POST ${AUTH}/v1/session/refresh`)).toBe(1);
    expect(server.count(`GET ${API}/api/auth/session`)).toBe(6);
  });

  it("discards a refresh that completes after the session was cleared", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = upstream({
      [`POST ${AUTH}/v1/session/refresh`]: async () => {
        await gate;
        return refreshed("next");
      },
    });
    const client = session(server, { initial: tokens("access", Date.now() + 1_000) });

    const pending = client.use((s) => s.ensureFreshAccess());
    await new Promise((resolve) => setTimeout(resolve, 5));
    await client.use((s) => s.setTokens(null));
    release();

    await expect(pending).resolves.toBeNull();
    expect(client.store.get()).toBeNull();
  });

  it("does not replay when refresh is explicitly rejected", async () => {
    let rejections = 0;
    const server = upstream({
      [`POST ${AUTH}/v1/session/refresh`]: () => Response.json({}, { status: 401 }),
      [`GET ${API}/api/auth/session`]: () => Response.json({ message: "Expired" }, { status: 401 }),
    });
    const client = session(server, {
      initial: tokens("access", Date.now() + 60_000),
      rejected: () => {
        rejections += 1;
      },
    });

    await expect(client.use((s) => s.workspace)).rejects.toMatchObject({ status: 401 });
    expect(server.count(`GET ${API}/api/auth/session`)).toBe(1);
    expect(rejections).toBe(1);
    expect(client.store.get()).toBeNull();
  });

  it("rejects malformed successful JSON at the HTTP boundary", async () => {
    const server = upstream({
      [`GET ${API}/api/auth/session`]: () => new Response("not-json", { status: 200 }),
    });
    const client = session(server, { initial: tokens("access", Date.now() + 60_000) });

    await expect(client.use((s) => s.workspace)).rejects.toMatchObject({
      status: 502,
      code: "INVALID_RESPONSE",
    });
  });
});
