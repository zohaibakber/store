import type { WorkspaceSnapshot } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

import type { AppHost } from "@/host";
import { altNewSaleShortcut } from "@/lib/new-sale-shortcut";
import { makeReplayChannel } from "@/replay-channel";

import { WebAuthBroker, type WebAuthBrokerOptions } from "./auth-broker";

const SIGN_IN_PATH = "/sign-in";

type BrowserLocation = Pick<Location, "origin" | "href" | "pathname" | "assign">;
type BrowserHistory = Pick<History, "state" | "replaceState">;

export type WebAppHostOptions = WebAuthBrokerOptions & {
  readonly location: BrowserLocation;
  readonly history: BrowserHistory;
};

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
  const sessions = makeReplayChannel<WorkspaceSnapshot>();
  const transitions = Semaphore.makeUnsafe(1);
  let pendingOAuthCallback = claimOAuthCallback(options.location, options.history);

  const publish = (snapshot: WorkspaceSnapshot) => {
    sessions.publish(snapshot);
    return snapshot;
  };
  const broker = new WebAuthBroker(options, publish);
  const serialize = <A>(transition: () => Promise<A>): Promise<A> =>
    Effect.runPromise(transitions.withPermit(Effect.promise(transition)));

  const host: AppHost = {
    auth: {
      getSession: async () => publish(broker.snapshot),
      adoptSession: (issued) => serialize(() => broker.adoptSession(issued)),
      renewSession: () => serialize(() => broker.renewSession()),
      signOut: () => serialize(() => broker.signOut()),
      organizationRoster: () => broker.organizationRoster(),
      organize: (command) => broker.organize(command),
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
    analyseInvoices: (files) => broker.analyseInvoices(files),
    newSaleShortcut: altNewSaleShortcut,
  };

  return {
    host,
    authenticatedFetch: broker.apiFetch,
    liveAccessToken: ({ force }: { readonly force: boolean }) => broker.liveAccessToken(force),
    initialize: () => broker.initialize(),
  };
};
