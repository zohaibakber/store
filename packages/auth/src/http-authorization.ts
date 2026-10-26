import * as Context from "effect/Context";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpApiSecurity from "effect/http-api/HttpApiSecurity";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { AuthUnauthenticated } from "./http-errors";

export class CurrentAccessToken extends Context.Service<
  CurrentAccessToken,
  Redacted.Redacted<string>
>()("@store/auth/CurrentAccessToken") {}

export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: CurrentAccessToken }
>()("@store/auth/Authorization", {
  security: {
    bearer: HttpApiSecurity.bearer,
  },
  error: AuthUnauthenticated,
}) {}

export const presentedCredential = (credential: Redacted.Redacted<string>) =>
  Redacted.value(credential).length > 0 ? Option.some(credential) : Option.none();

export const bearerTokenFromHeaders = (headers: Headers) => {
  const [scheme, token] = (headers.get("authorization") ?? "").split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token.trim() || null;
};
