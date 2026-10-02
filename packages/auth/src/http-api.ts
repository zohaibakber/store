import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as Schema from "effect/Schema";

import { Authorization } from "./http-authorization";
import { AuthBadRequest, AuthHttpErrors } from "./http-errors";
import { AuthJwks } from "./jwt";
import {
  BeginGoogleInput,
  ExchangeGoogleIdTokenInput,
  ExchangeGoogleInput,
  GoogleAuthorization,
  IdentifyInput,
  IssuedSession,
  LoginRoute,
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
  OtpLoginCommand,
  PasswordLoginCommand,
  RefreshedSession,
  RefreshInput,
  RegisterPasswordCommand,
  SignOutInput,
} from "./model";

export class MalformedRequest extends HttpApiMiddleware.Service<MalformedRequest>()(
  "@store/auth/MalformedRequest",
  { error: AuthBadRequest },
) {}

const Health = Schema.Struct({ ok: Schema.Literal(true) });

const authSystemGroup = HttpApiGroup.make("system")
  .add(HttpApiEndpoint.get("landing", "/", { success: Health }))
  .add(HttpApiEndpoint.get("health", "/health", { success: Health }))
  .add(HttpApiEndpoint.get("jwks", "/.well-known/jwks.json", { success: AuthJwks }));

const authSessionGroup = HttpApiGroup.make("session")
  .add(
    HttpApiEndpoint.post("identify", "/v1/identify", {
      payload: IdentifyInput,
      success: LoginRoute,
      error: AuthHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("signInPassword", "/v1/sign-in/password", {
      payload: PasswordLoginCommand,
      success: IssuedSession,
      error: AuthHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("signInOtp", "/v1/sign-in/otp", {
      payload: OtpLoginCommand,
      success: IssuedSession,
      error: AuthHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("signUpPassword", "/v1/sign-up/password", {
      payload: RegisterPasswordCommand,
      success: IssuedSession,
      error: AuthHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("googleStart", "/v1/oauth/google/start", {
      payload: BeginGoogleInput,
      success: GoogleAuthorization,
      error: AuthHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("googleExchange", "/v1/oauth/google/exchange", {
      payload: ExchangeGoogleInput,
      success: IssuedSession,
      error: AuthHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("googleNative", "/v1/oauth/google/native", {
      payload: ExchangeGoogleIdTokenInput,
      success: IssuedSession,
      error: AuthHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("refresh", "/v1/session/refresh", {
      payload: RefreshInput,
      success: RefreshedSession,
      error: AuthHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("logout", "/v1/session/logout", {
      payload: SignOutInput,
      success: Health,
      error: AuthHttpErrors,
    }),
  );

const authOrganizationGroup = HttpApiGroup.make("organization")
  .add(
    HttpApiEndpoint.get("roster", "/v1/organization", {
      success: OrganizationRoster,
      error: AuthHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("command", "/v1/organization", {
      payload: OrganizationCommand,
      success: OrganizationCommandResult,
      error: AuthHttpErrors,
    }),
  )
  .middleware(Authorization);

export const AuthHttpApi = HttpApi.make("AuthHttpApi")
  .add(authSystemGroup, authSessionGroup, authOrganizationGroup)
  .middleware(MalformedRequest);
