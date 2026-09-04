import {
  AuthorizationCode,
  makeAuthClient,
  nativeClient,
  browserClient,
  type AuthClientKind,
  type IdentifyInput,
  type LoginCommand,
  type LoginRoute,
  type TokenSet,
} from "@store/auth";
import * as Schema from "effect/Schema";

import { authSession } from "@/lib/auth";
import { runClientEffect } from "@/lib/sentry";

const PKCE_KEY = "tabaaq-oauth-pkce";
export const GOOGLE_AUTH_ERROR_EVENT = "tabaaq:google-auth-error";
const configuredAuthUrl = import.meta.env.VITE_AUTH_URL?.trim();

export const authBaseUrl = (configuredAuthUrl || "http://localhost:8788").replace(/\/+$/u, "");

const client = makeAuthClient({ baseUrl: authBaseUrl });

const currentClient = (): AuthClientKind =>
  window.auth ? nativeClient("Tabaaq Desktop") : browserClient();

const run = runClientEffect;

export const identify = (input: IdentifyInput): Promise<LoginRoute> => run(client.identify(input));

export const authenticate = async (command: LoginCommand): Promise<TokenSet> => {
  const tokens = await run(client.authenticate(command));
  await authSession().adoptSession(tokens);
  return tokens;
};

const base64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
};

const pkce = async () => {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  return { verifier, challenge };
};

export const beginGoogle = async () => {
  const { verifier, challenge } = await pkce();
  sessionStorage.setItem(PKCE_KEY, verifier);
  const native = Boolean(window.auth);
  const redirectUri = window.auth
    ? await window.auth.getOAuthRedirectUri()
    : `${window.location.origin}/`;
  const authorization = await run(
    client.beginGoogle({
      redirectUri,
      codeChallenge: challenge,
      client: currentClient(),
    }),
  );
  if (native && window.auth) {
    await window.auth.openExternal(authorization.url);
    return;
  }
  window.location.assign(authorization.url);
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
  if (!window.auth) {
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
  }
  return true;
};

export const reportGoogleAuthError = (cause: unknown) => {
  const message = cause instanceof Error ? cause.message : "Google sign-in could not be completed.";
  window.dispatchEvent(new CustomEvent(GOOGLE_AUTH_ERROR_EVENT, { detail: message }));
};

export const currentAuthClient = currentClient;
