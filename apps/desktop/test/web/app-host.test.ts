import { MAX_INVOICE_UPLOAD_BYTES } from "@store/contracts";
import type { WorkspaceSnapshot } from "@store/contracts";
import { describe, expect, it } from "vitest";

import { createWebAppHost } from "../../src/web/app-host";
import {
  API,
  AUTH,
  authenticatedWorkspace,
  browserTokens,
  fakeSessionServer,
  memoryStorage,
} from "./fake-session-server";

const browserAt = (href: string) => {
  const assigned: Array<string> = [];
  const replaced: Array<string> = [];
  const url = new URL(href);
  return {
    assigned,
    replaced,
    location: {
      origin: url.origin,
      href: url.href,
      pathname: url.pathname,
      assign: (next: string | URL) => {
        assigned.push(next.toString());
      },
    },
    history: {
      state: null,
      replaceState: (_state: History["state"], _unused: string, next?: string | URL | null) => {
        replaced.push(next?.toString() ?? "");
      },
    },
  };
};

const makeHost = (href: string, server = fakeSessionServer({})) => {
  const browser = browserAt(href);
  const web = createWebAppHost({
    apiBaseUrl: API,
    authBaseUrl: AUTH,
    fetch: server.fetch,
    storage: memoryStorage(),
    isOnline: () => true,
    location: browser.location,
    history: browser.history,
  });
  return { ...web, browser, server };
};

describe("web sign-in", () => {
  it("signs in as a browser client and returns to /sign-in on this origin", async () => {
    const { host } = makeHost("https://tabaaq.example/");

    expect(host.signIn.client).toEqual({ _tag: "Browser" });
    await expect(host.signIn.oauthRedirectUri()).resolves.toBe("https://tabaaq.example/sign-in");
  });

  it("opens only Google authorization URLs", async () => {
    const { host, browser } = makeHost("https://tabaaq.example/sign-in");

    await expect(host.signIn.openAuthorization("javascript:alert(1)")).rejects.toThrow(
      "Only Google authorization URLs",
    );
    await host.signIn.openAuthorization("https://accounts.google.com/o/oauth2/v2/auth?x=1");

    expect(browser.assigned).toEqual(["https://accounts.google.com/o/oauth2/v2/auth?x=1"]);
  });

  it("takes the OAuth code out of the address bar and hands it over once", () => {
    const { host, browser } = makeHost("https://tabaaq.example/sign-in?code=abc&state=s");
    const delivered: Array<string> = [];

    host.signIn.onOAuthCallback?.((url) => delivered.push(url));
    host.signIn.onOAuthCallback?.((url) => delivered.push(url));

    expect(browser.replaced).toEqual(["/sign-in"]);
    expect(delivered).toEqual(["https://tabaaq.example/sign-in?code=abc&state=s"]);
  });

  it("leaves other addresses alone", () => {
    const { host, browser } = makeHost("https://tabaaq.example/products?code=abc");
    const delivered: Array<string> = [];

    host.signIn.onOAuthCallback?.((url) => delivered.push(url));

    expect(browser.replaced).toEqual([]);
    expect(delivered).toEqual([]);
  });
});

describe("web session bridge", () => {
  it("publishes adopted and signed-out sessions to subscribers", async () => {
    const server = fakeSessionServer({
      [`GET ${API}/api/auth/session`]: () => Response.json(authenticatedWorkspace),
      [`POST ${AUTH}/v1/session/logout`]: () => Response.json({ ok: true }),
    });
    const { host, initialize } = makeHost("https://tabaaq.example/", server);
    const seen: Array<WorkspaceSnapshot["status"]> = [];
    host.auth.onSessionChange((snapshot) => seen.push(snapshot.status));

    await initialize();
    await host.auth.adoptSession(browserTokens());
    await host.auth.signOut();

    expect(seen).toEqual(["unauthenticated", "authenticated", "unauthenticated"]);
    await expect(host.auth.getSession()).resolves.toMatchObject({ status: "unauthenticated" });
  });
});

describe("web invoice analysis", () => {
  const extraction = { supplier: null, invoiceNumber: null, lines: [] };

  it("rejects oversized uploads before any request", async () => {
    const { host, server } = makeHost("https://tabaaq.example/");

    await expect(
      host.analyseInvoices([
        { name: "big.pdf", type: "", bytes: new ArrayBuffer(MAX_INVOICE_UPLOAD_BYTES + 1) },
      ]),
    ).rejects.toThrow("too large");
    expect(server.requests).toEqual([]);
  });

  it("posts the files as multipart with the access token and decodes the extraction", async () => {
    const server = fakeSessionServer({
      [`GET ${API}/api/auth/session`]: () => Response.json(authenticatedWorkspace),
      [`POST ${API}/api/uploads`]: () => Response.json(extraction),
    });
    const { host } = makeHost("https://tabaaq.example/", server);
    await host.auth.adoptSession(browserTokens());

    const result = await host.analyseInvoices([
      { name: "Invoice.PDF", type: "", bytes: new TextEncoder().encode("%PDF").buffer },
    ]);

    expect(result).toEqual(extraction);
    const upload = server.requests.at(-1);
    expect(upload?.authorization).toBe("Bearer access-token");
    const file = upload?.form?.get("files");
    expect(file).toBeInstanceOf(File);
    expect(file instanceof File ? file.type : null).toBe("application/pdf");
  });

  it("reports an unexpected extraction shape", async () => {
    const server = fakeSessionServer({
      [`GET ${API}/api/auth/session`]: () => Response.json(authenticatedWorkspace),
      [`POST ${API}/api/uploads`]: () => Response.json({ lines: "nope" }),
    });
    const { host } = makeHost("https://tabaaq.example/", server);
    await host.auth.adoptSession(browserTokens());

    await expect(
      host.analyseInvoices([{ name: "a.csv", type: "text/csv", bytes: new ArrayBuffer(4) }]),
    ).rejects.toThrow("unexpected response");
  });
});
