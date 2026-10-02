import type { WorkspaceSnapshot } from "@store/contracts";
import { isWhatsAppUrl } from "@store/services/purchasing";
import { SessionHttp, sessionFetch } from "@store/workspace";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";

import type { AppHost } from "@/host";
import { analyseInvoiceUpload } from "@/host/invoice-upload";
import { altNewSaleShortcut } from "@/host/new-sale-shortcut";
import { makeReplayChannel } from "@/host/replay-channel";
import { browserSignIn, browserStore } from "@/lib/first-party-auth";

import { WebAuth, layerWebAuth, type WebAuthBrokerOptions } from "./auth-broker";

const SIGN_IN_PATH = "/sign-in";

type BrowserLocation = Pick<Location, "origin" | "href" | "pathname" | "assign">;
type BrowserHistory = Pick<History, "state" | "replaceState">;

type WebAppHostOptions = WebAuthBrokerOptions & {
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

class AuthorizationRefused extends Schema.TaggedError<AuthorizationRefused>()(
  "AuthorizationRefused",
  { message: Schema.String },
) {}

export const createWebAppHost = (options: WebAppHostOptions) => {
  const sessions = makeReplayChannel<WorkspaceSnapshot>();
  let pendingOAuthCallback = claimOAuthCallback(options.location, options.history);

  const publish = (snapshot: WorkspaceSnapshot) => {
    sessions.publish(snapshot);
    return snapshot;
  };
  const runtime = ManagedRuntime.make(layerWebAuth(options, publish));
  const signIn = browserSignIn({
    redirectUri: `${options.location.origin}${SIGN_IN_PATH}`,
    storage: browserStore(() => globalThis.sessionStorage),
    openAuthorization: (url) =>
      isGoogleAuthorizationUrl(url)
        ? Effect.sync(() => options.location.assign(url))
        : Effect.fail(
            new AuthorizationRefused({ message: "Only Google authorization URLs can be opened." }),
          ),
    adopt: (issued) => WebAuth.use((auth) => auth.adopt(issued)),
  });

  const host: AppHost = {
    auth: {
      getSession: () =>
        runtime.runPromise(
          Effect.map(
            WebAuth.use((auth) => auth.snapshot),
            publish,
          ),
        ),
      renewSession: () => runtime.runPromise(WebAuth.use((auth) => auth.renewSession)),
      signOut: () => runtime.runPromise(WebAuth.use((auth) => auth.signOut)),
      organizationRoster: () =>
        runtime.runPromise(SessionHttp.use((session) => session.organizationRoster)),
      organize: (command) =>
        runtime.runPromise(SessionHttp.use((session) => session.organize(command))),
      onSessionChange: sessions.subscribe,
    },
    signIn: {
      identify: (input) => runtime.runPromise(signIn.identify(input)),
      authenticate: (credentials) => runtime.runPromise(signIn.authenticate(credentials)),
      beginGoogle: () => runtime.runPromise(signIn.beginGoogle),
      completeGoogle: (callbackUrl) => runtime.runPromise(signIn.completeGoogle(callbackUrl)),
      hasPendingOAuthCallback: () => pendingOAuthCallback !== null,
      onOAuthCallback: (listener) => {
        const callback = pendingOAuthCallback;
        pendingOAuthCallback = null;
        if (callback) listener(callback);
        return () => undefined;
      },
    },
    analyseInvoices: (files) => runtime.runPromise(analyseInvoiceUpload(files)),
    newSaleShortcut: altNewSaleShortcut,
    openExternal: async (url) => {
      if (!isWhatsAppUrl(url)) throw new Error("Only WhatsApp links can be opened.");
      window.open(url, "_blank", "noopener");
    },
    copyText: (text) => navigator.clipboard.writeText(text),
    savePdf: async () => {
      window.print();
      return { _tag: "printed" };
    },
  };

  return {
    host,
    authenticatedFetch: sessionFetch((effect, runOptions) =>
      runtime.runPromise(effect, runOptions),
    ),
    liveAccessToken: ({ force }: { readonly force: boolean }) =>
      runtime.runPromise(
        SessionHttp.use((session) => session.ensureFreshAccess(force)).pipe(
          Effect.map((access) => access?.accessToken ?? null),
        ),
      ),
    sessionExpected: () => runtime.runPromise(WebAuth.use((auth) => auth.sessionExpected)),
    initialize: () => runtime.runPromise(WebAuth.use((auth) => auth.initialize)),
  };
};
