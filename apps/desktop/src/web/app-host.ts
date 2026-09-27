import type { WorkspaceSnapshot } from "@store/contracts";
import { fetchOrganizationRoster, organizeOrganization } from "@store/workspace";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

import type { AppHost } from "@/host";
import { analyseInvoiceUpload } from "@/lib/invoice-upload";
import { altNewSaleShortcut } from "@/lib/new-sale-shortcut";
import { makeReplayChannel } from "@/replay-channel";

import { WebAuthBroker, type WebAuthBrokerOptions } from "./auth-broker";

export const SIGN_IN_PATH = "/sign-in";

type BrowserLocation = Pick<Location, "origin" | "href" | "pathname" | "assign">;
type BrowserHistory = Pick<History, "state" | "replaceState">;

export type WebAppHostOptions = WebAuthBrokerOptions & {
  readonly location: BrowserLocation;
  readonly history: BrowserHistory;
};

/**
 * Google redirects back to `/sign-in?code=…`. Take the code out of the
 * address bar before the router reads it, and hold it for the sign-in form.
 */
const claimOAuthCallback = (location: BrowserLocation, history: BrowserHistory) => {
  if (location.pathname !== SIGN_IN_PATH) return null;
  const url = new URL(location.href);
  if (!url.searchParams.has("code")) return null;
  history.replaceState(history.state, "", SIGN_IN_PATH);
  return url.href;
};

const isGoogleAuthorizationUrl = (candidate: string) => {
  const url = URL.parse(candidate);
  return url?.protocol === "https:" && url.hostname === "accounts.google.com";
};

export const createWebAppHost = (options: WebAppHostOptions) => {
  const broker = new WebAuthBroker(options);
  const sessions = makeReplayChannel<WorkspaceSnapshot>();
  const transitions = Semaphore.makeUnsafe(1);
  let pendingOAuthCallback = claimOAuthCallback(options.location, options.history);

  const publish = (snapshot: WorkspaceSnapshot) => {
    sessions.publish(snapshot);
    return snapshot;
  };
  const serialize = <A>(transition: () => Promise<A>): Promise<A> =>
    Effect.runPromise(transitions.withPermit(Effect.promise(transition)));
  const authRequest = broker.authRequest.bind(broker);

  const host: AppHost = {
    auth: {
      getSession: async () => publish(broker.snapshot),
      adoptSession: (tokens) => serialize(() => broker.adoptSession(tokens).then(publish)),
      renewSession: () => serialize(() => broker.renewSession().then(publish)),
      signOut: () =>
        serialize(async () => {
          await broker.signOut();
          publish(broker.snapshot);
        }),
      organizationRoster: () => fetchOrganizationRoster(authRequest),
      organize: (command) => organizeOrganization(authRequest, command),
      onSessionChange: sessions.subscribe,
    },
    signIn: {
      client: { _tag: "Browser" },
      oauthRedirectUri: async () => `${options.location.origin}${SIGN_IN_PATH}`,
      openAuthorization: async (url) => {
        if (!isGoogleAuthorizationUrl(url)) {
          throw new Error("Only Google authorization URLs can be opened.");
        }
        options.location.assign(url);
      },
      onOAuthCallback: (listener) => {
        const callback = pendingOAuthCallback;
        pendingOAuthCallback = null;
        if (callback) listener(callback);
        return () => undefined;
      },
    },
    analyseInvoices: (files) =>
      analyseInvoiceUpload((pathname, init) => broker.apiRequest(pathname, init), files),
    newSaleShortcut: altNewSaleShortcut,
  };

  return {
    host,
    authenticatedFetch: (input: RequestInfo | URL, init?: RequestInit) =>
      broker.apiFetch(input, init),
    initialize: async () => publish(await broker.initialize()),
  };
};
