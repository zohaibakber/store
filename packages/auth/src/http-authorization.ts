import * as Context from "effect/Context";
import * as Redacted from "effect/Redacted";
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";
import * as HttpApiSecurity from "effect/unstable/httpapi/HttpApiSecurity";

import { AuthUnauthenticated } from "./http-errors";

export class CurrentAccessToken extends Context.Service<CurrentAccessToken, string>()(
  "@store/auth/CurrentAccessToken",
) {}

export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: CurrentAccessToken }
>()("@store/auth/Authorization", {
  security: {
    bearer: HttpApiSecurity.bearer,
  },
  error: AuthUnauthenticated,
}) {}

export const refreshCookieSecurity = (secureCookies: boolean) =>
  HttpApiSecurity.apiKey({
    in: "cookie",
    key: secureCookies ? "__Host-tabaaq_refresh" : "tabaaq_refresh",
  });

export const refreshCookieName = (secureCookies: boolean) => refreshCookieSecurity(secureCookies).key;

export const refreshCookieOptions = (secureCookies: boolean) =>
  ({
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax" as const,
    path: "/",
  }) as const;

export const optionalRedactedValue = (credential: Redacted.Redacted<string>) => {
  const value = Redacted.value(credential);
  return value.length > 0 ? value : undefined;
};
