import { AccessToken, TokenSet } from "@store/auth";
import { decodeAuthenticatedWorkspace } from "@store/contracts";

import type { SessionHintStore } from "../../src/web/auth-broker";

export const API = "http://localhost:8787";
export const AUTH = "http://localhost:8788";
export const HINT_KEY = "tabaaq-web-session-expected";

export const authenticatedWorkspace = decodeAuthenticatedWorkspace({
  status: "authenticated",
  isOnline: true,
  user: { id: "u1", name: "A", email: "a@b.c", image: null },
  activeOrganization: { id: "o1", name: "Org", slug: "org", role: "owner" },
  organizations: [{ id: "o1", name: "Org", slug: "org", role: "owner" }],
});

export const browserTokens = (accessToken = "access-token") =>
  TokenSet.make({
    accessToken: AccessToken.make(accessToken),
    accessExpiresAt: Date.now() + 10 * 60_000,
    refreshExpiresAt: Date.now() + 60 * 60_000,
  });

export type RecordedRequest = {
  readonly method: string;
  readonly url: string;
  readonly credentials: RequestCredentials;
  readonly authorization: string | null;
  readonly body: string;
  readonly form: FormData | null;
};

type Route = (request: RecordedRequest) => Response | Promise<Response>;

/** A fetch double that answers by `METHOD url` and records what the broker sent. */
export const fakeSessionServer = (routes: Readonly<Record<string, Route>>) => {
  const requests: Array<RecordedRequest> = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const multipart = request.headers.get("content-type")?.startsWith("multipart/form-data");
    const form = multipart ? await request.clone().formData() : null;
    const recorded: RecordedRequest = {
      method: request.method,
      url: request.url,
      credentials: init?.credentials ?? request.credentials,
      authorization: request.headers.get("authorization"),
      body: form ? "" : await request.text(),
      form,
    };
    requests.push(recorded);
    const route = routes[`${recorded.method} ${recorded.url}`];
    if (!route) throw new TypeError(`Unexpected request: ${recorded.method} ${recorded.url}`);
    return route(recorded);
  };
  return { fetch, requests };
};

export const memoryStorage = (): SessionHintStore & { readonly entries: Map<string, string> } => {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
};
