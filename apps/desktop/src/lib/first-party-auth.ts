import {
  AuthorizationCode,
  makeAuthClient,
  type AuthClientKind,
  type IdentifyInput,
  type LoginCommand,
  type LoginRoute,
  type TokenSet,
} from "@store/auth";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Schema from "effect/Schema";

import { appHost } from "@/host";
import { authSession } from "@/lib/auth";

const PKCE_KEY = "tabaaq-oauth-pkce";
const configuredAuthUrl = import.meta.env.VITE_AUTH_URL?.trim();

export const authBaseUrl = (configuredAuthUrl || "http://localhost:8788").replace(/\/+$/u, "");

const client = makeAuthClient({ baseUrl: authBaseUrl });

const currentClient = (): AuthClientKind => appHost().signIn.client;

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

export const identify = (input: IdentifyInput): Promise<LoginRoute> => run(client.identify(input));

export const authenticate = async (command: LoginCommand): Promise<TokenSet> => {
  const tokens = await run(client.authenticate(command));
  await authSession().adoptSession(tokens);
  return tokens;
};

const pkce = async () => {
  const verifier = Encoding.encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = Encoding.encodeBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  return { verifier, challenge };
};

export const beginGoogle = async () => {
  const { verifier, challenge } = await pkce();
  sessionStorage.setItem(PKCE_KEY, verifier);
  const signIn = appHost().signIn;
  const redirectUri = await signIn.oauthRedirectUri();
  const authorization = await run(
    client.beginGoogle({
      redirectUri,
      codeChallenge: challenge,
      client: signIn.client,
    }),
  );
  await signIn.openAuthorization(authorization.url);
};

export const completeGoogle = async (callbackUrl: string) => {
  const url = new URL(callbackUrl);
  const code = url.searchParams.get("code");
  const verifier = sessionStorage.getItem(PKCE_KEY);
  if (!code || !verifier) return false;
  sessionStorage.removeItem(PKCE_KEY);
  const authorizationCode = await run(Schema.decodeUnknownEffect(AuthorizationCode)(code));
  const tokens = await run(
    client.exchangeGoogle({
      code: authorizationCode,
      codeVerifier: verifier,
      client: currentClient(),
    }),
  );
  await authSession().adoptSession(tokens);
  return true;
};

export const currentAuthClient = currentClient;
